import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

// Detecta el tipo REAL mirando los primeros bytes (el mimetype lo declara el cliente y se puede falsear)
const detectarTipo = (b) => {
    if (b.length > 12 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return 'png';
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
    if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
    return null;
};

router.post('/logo', requireAuth, (req, res) => {
    upload.single('logo')(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'La imagen pesa más de 2 MB' : 'No se pudo subir la imagen' });
        if (!req.file) return res.status(400).json({ error: 'Falta la imagen' });

        const tipo = detectarTipo(req.file.buffer);
        if (!tipo) return res.status(400).json({ error: 'Solo se aceptan imágenes PNG, JPG o WEBP' });

        try {
            const nombre = `${randomUUID()}.${tipo}`; // nombre aleatorio: nunca usamos el que manda el cliente
            await fs.promises.writeFile(`./uploads/${nombre}`, req.file.buffer);
            res.status(201).json({ url: `/uploads/${nombre}` });
        } catch {
            res.status(500).json({ error: 'No se pudo guardar la imagen' });
        }
    });
})

export default router;