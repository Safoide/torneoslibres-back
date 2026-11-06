import fs from 'fs';
import { randomUUID } from 'crypto';
import { logoValido } from '../config.js';
import { fueraDeEdad, textoLimiteEdad, edadEn } from './torneosManager.js';

// YYYY-MM-DD y que sea una fecha real (no 2001-02-30)
const fechaValida = (f) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
    const d = new Date(f + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
};

const MAX_JUGADORES = 30;

class ClubesManager {
    constructor(path, equiposManager, torneosManager) {
        this.path = path;
        this.equiposManager = equiposManager;
        this.torneosManager = torneosManager;
        this.clubes = JSON.parse(fs.readFileSync(path));
    }

    save() {
        return fs.promises.writeFile(this.path, JSON.stringify(this.clubes, null, 4));
    }

    getRawByOwner(ownerId) {
        return this.clubes.find(c => c.ownerId === ownerId) || null;
    }

    // Lo que ve el capitan (todo menos el ownerId)
    privado({ ownerId, ...club }) {
        return club;
    }

    miEquipo(ownerId) {
        const club = this.getRawByOwner(ownerId);
        return club ? this.privado(club) : null;
    }

    // Valida y limpia lo que manda el usuario (nunca se copia el body entero)
    limpiar(data = {}, idActual = null) {
        const nombre = String(data.nombre ?? '').trim();
        const whatsapp = String(data.whatsapp ?? '').replace(/\D/g, '');
        const logo = String(data.logo ?? '').trim();

        if (nombre.length < 3 || nombre.length > 40) return { error: 'El nombre del equipo debe tener entre 3 y 40 caracteres' };
        if (whatsapp.length < 10 || whatsapp.length > 15) return { error: 'Ingresá tu WhatsApp con código de país (10 a 15 dígitos)' };
        if (logo && !logoValido(logo)) return { error: 'El logo no es válido: subí la imagen de nuevo' };

        const lista = Array.isArray(data.jugadores) ? data.jugadores : [];
        if (lista.length > MAX_JUGADORES) return { error: `El plantel admite hasta ${MAX_JUGADORES} jugadores` };

        const jugadores = [];

        for (const [i, j] of lista.entries()) {
            const n = i + 1;
            const nombreJ = String(j?.nombre ?? '').trim();
            const apellido = String(j?.apellido ?? '').trim();
            const dni = String(j?.dni ?? '').replace(/\D/g, '');
            const nacimiento = String(j?.nacimiento ?? '').trim();

            if (!nombreJ || nombreJ.length > 40 || !apellido || apellido.length > 40) return { error: `Jugador ${n}: completá nombre y apellido` };
            if (dni.length < 7 || dni.length > 8) return { error: `Jugador ${n}: el DNI debe tener 7 u 8 dígitos` };
            if (!nacimiento) return { error: `Jugador ${n}: completá la fecha de nacimiento` };
            if (!fechaValida(nacimiento)) return { error: `Jugador ${n}: la fecha de nacimiento no es válida` };
            const edad = edadEn(nacimiento);
            if (edad < 10 || edad > 80) return { error: `Jugador ${n}: la fecha de nacimiento no es válida (tiene que tener entre 10 y 80 años)` };
            if (jugadores.some(x => x.dni === dni)) return { error: `Jugador ${n}: el DNI ${dni} está repetido` };

            jugadores.push({ nombre: nombreJ, apellido, dni, nacimiento });
        }

        if (this.clubes.some(c => c.id !== idActual && c.nombre.toLowerCase() === nombre.toLowerCase())) {
            return { error: 'Ya existe un equipo con ese nombre' };
        }

        return { datos: { nombre, logo, whatsapp, jugadores } };
    }

    // Solo el WhatsApp del capitan (se edita tambien desde "Editar mis datos")
    async cambiarWhatsapp(clubId, valor) {
        const club = this.clubes.find(c => c.id === clubId);
        if (!club) return { error: 'No se encontro el equipo' };

        const whatsapp = String(valor ?? '').replace(/\D/g, '');
        if (whatsapp.length < 10 || whatsapp.length > 15) return { error: 'Ingresá tu WhatsApp con código de país (10 a 15 dígitos)' };

        club.whatsapp = whatsapp;
        await this.save();

        return this.privado(club);
    }

    async crear(ownerId, data) {
        if (this.getRawByOwner(ownerId)) return { error: 'Ya tenés un equipo. Solo se puede tener uno por cuenta.' };

        const { error, datos } = this.limpiar(data);
        if (error) return { error };

        const club = { id: `CLUB-${randomUUID().slice(0, 8)}`, ...datos, ownerId, creado: new Date().toISOString() };

        this.clubes.push(club);
        await this.save();

        return this.privado(club);
    }

    async editar(clubId, data) {
        const club = this.clubes.find(c => c.id === clubId);
        if (!club) return { error: 'No se encontro el equipo' };

        const { error, datos } = this.limpiar(data, clubId);
        if (error) return { error };

        // Si esta anotado en un torneo con limite de edad que no termino, el plantel nuevo tiene que seguir cumpliendolo
        for (const e of this.equiposManager.getEquipos().filter(e => e.club_id === clubId)) {
            const tor = this.torneosManager.getTorneoById(e.tor_id);
            if (tor.error || tor.estado === 'finalizado' || !tor.limiteEdad) continue;

            const [j] = fueraDeEdad(datos.jugadores, tor);
            if (j) return { error: `${j.nombre} ${j.apellido} (${j.edad} al inicio) no cumple con el límite de edad de "${tor.nombre}" (${textoLimiteEdad(tor.limiteEdad)}), donde tu equipo está inscripto` };
        }

        Object.assign(club, datos);
        await this.save();

        // El nombre y el logo se copian en cada torneo donde esta inscripto: los mantenemos al dia
        for (const e of this.equiposManager.getEquipos().filter(e => e.club_id === clubId)) {
            await this.equiposManager.editTeam(e.id, { name: datos.nombre, logo: datos.logo });
        }

        return this.privado(club);
    }

    async eliminar(clubId) {
        if (!this.clubes.some(c => c.id === clubId)) return { error: 'No se encontro el equipo' };

        const activo = this.equiposManager.getEquipos().some(e => {
            if (e.club_id !== clubId) return false;
            const tor = this.torneosManager.getTorneoById(e.tor_id);
            return !tor.error && tor.estado !== 'finalizado';
        });

        if (activo) return { error: 'No podés eliminar el equipo: está inscripto en un torneo que no terminó.' };

        this.clubes = this.clubes.filter(c => c.id !== clubId);
        await this.save();

        return { ok: true };
    }
}

export default ClubesManager;