// Pasarela de pago FALSA. Para pasar a Mercado Pago real se reemplaza solo este archivo.
export const cobrar = async ({ monto, metodo, simular }) => {
    await new Promise(resolve => setTimeout(resolve, 1200));

    if (simular === 'rechazado') {
        return { ok: false, motivo: 'Pago rechazado (simulado). Probá de nuevo.' };
    }

    return { ok: true, id: `PAY-${Date.now()}`, metodo, monto };
};
