import fs from 'fs';
import { formatId } from '../assets.js';

const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;

class OrganizadoresManager {
    constructor(path, torneosManager) {
        this.path = path;
        this.torneosManager = torneosManager;
        this.organizadores = JSON.parse(fs.readFileSync(path));
    }

    save() {
        return fs.promises.writeFile(this.path, JSON.stringify(this.organizadores, null, 4));
    }

    torneosDe(orgId) {
        return this.torneosManager.getTorneos().filter(t => t.organizadorId === orgId);
    }

    // No exponemos el ownerId y agregamos la cantidad de torneos
    publico({ ownerId, ...org }) {
        return { ...org, torneos: this.torneosDe(org.id).length };
    }

    nextId() {
        const max = this.organizadores.reduce((acc, o) => Math.max(acc, parseInt(o.id.split('-')[1], 10) || 0), 0);
        return formatId('ORG', max + 1);
    }

    getAll() {
        return this.organizadores.map(o => this.publico(o));
    }

    getById(id) {
        const org = this.organizadores.find(o => o.id === id);
        return org ? this.publico(org) : { error: 'No se encontro un organizador con el id especificado' };
    }

    // La organizacion del usuario (o null si no tiene)
    miOrganizacion(ownerId) {
        const org = this.organizadores.find(o => o.ownerId === ownerId);
        return org ? this.publico(org) : null;
    }

    // Valida y limpia los campos que puede mandar el usuario
    limpiar(data = {}, idActual = null) {
        const nombre = String(data.nombre ?? '').trim();
        const zona = String(data.zona ?? '').trim();
        const descripcion = String(data.descripcion ?? '').trim();
        const instagram = String(data.instagram ?? '').trim().replace(/^@/, '');
        const whatsapp = String(data.whatsapp ?? '').replace(/\D/g, '');
        const logo = String(data.logo ?? '').trim();

        if (nombre.length < 3 || nombre.length > 60) return { error: 'El nombre debe tener entre 3 y 60 caracteres' };
        if (!zona || zona.length > 40) return { error: 'Indicá la zona (hasta 40 caracteres)' };
        if (descripcion.length > 300) return { error: 'La descripción puede tener hasta 300 caracteres' };
        if (instagram && !HANDLE_RE.test(instagram)) return { error: 'El usuario de Instagram no es válido (sin @ ni links)' };
        if (whatsapp && (whatsapp.length < 10 || whatsapp.length > 15)) return { error: 'El WhatsApp debe tener entre 10 y 15 dígitos, con código de país' };
        if (logo && !/^\/uploads\/[\w-]{1,80}\.(png|jpg|webp)$/i.test(logo)) return { error: 'El logo no es válido' };

        if (this.organizadores.some(o => o.id !== idActual && o.nombre.toLowerCase() === nombre.toLowerCase())) {
            return { error: 'Ya existe una organización con ese nombre' };
        }

        return { datos: { nombre, zona, descripcion, instagram, whatsapp, logo } };
    }

    async crear(ownerId, data) {
        if (this.organizadores.some(o => o.ownerId === ownerId)) {
            return { error: 'Ya tenés una organización. Solo se puede tener una por cuenta.' };
        }

        const { error, datos } = this.limpiar(data);
        if (error) return { error };

        const org = { id: this.nextId(), ...datos, ownerId, creada: new Date().toISOString() };

        this.organizadores.push(org);
        await this.save();

        return this.publico(org);
    }

    async editar(orgId, data) {
        const org = this.organizadores.find(o => o.id === orgId);
        if (!org) return { error: 'No se encontro un organizador con el id especificado' };

        const { error, datos } = this.limpiar(data, orgId);
        if (error) return { error };

        Object.assign(org, datos);
        await this.save();

        // El nombre se repite en cada torneo, lo mantenemos al dia
        for (const tor of this.torneosDe(orgId)) {
            await this.torneosManager.editTor(tor.id, { organizador: datos.nombre });
        }

        return this.publico(org);
    }

    async eliminar(orgId) {
        if (!this.organizadores.some(o => o.id === orgId)) return { error: 'No se encontro un organizador con el id especificado' };

        const torneos = this.torneosDe(orgId);

        if (torneos.some(t => t.equiposInscriptos > 0)) {
            return { error: 'No podés eliminar la organización: tiene torneos con equipos inscriptos.' };
        }

        for (const tor of torneos) await this.torneosManager.deleteTor(tor.id);

        this.organizadores = this.organizadores.filter(o => o.id !== orgId);
        await this.save();

        return { ok: true };
    }
}

export default OrganizadoresManager;