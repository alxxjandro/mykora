// Modelo hidráulico 1D del filtro: lecho de capas en serie alimentado por gravedad.
// Unidades: mm, s (1 unidad de la escena = 1 mm). Caudal en mm³/s (1000 mm³/s = 1 mL/s).
//
// - Conductividad de cada capa: Kozeny–Carman, K = (ρg/μ) · n³d² / (180 (1−n)²).
// - Caudal a través de lo mojado: Darcy en serie, Q = A (h + z) / Σ(Lᵢ/Kᵢ).
// - Avance del frente y de cada parcela de agua: por volumen de poros, nᵢ·Lᵢ·A.
// - Entrada: válvula de flotador que mantiene el nivel sobre el lecho.
// - Masa: lo que entra solo puede estar en el cuello, en el lecho o haber salido.

// ρg/μ del agua a 20 °C, en 1/(mm·s)
const RHO_G_OVER_MU = 9810;

// Parámetros típicos de cada material: son ESTIMACIONES, no medidas del prototipo.
// n: porosidad · d: grano efectivo (mm) · lambda: retención de sólidos (1/mm, modelo de Iwasaki)
export const MATERIALS = {
    'Capsula_6': { n: 0.42, d: 12, lambda: 0.002 }, // grava gruesa
    'Capsula_2': { n: 0.38, d: 0.35, lambda: 0.05 }, // arena fina
    'Capsula_5': { n: 0.50, d: 1.5, lambda: 0.02 }, // zeolita
    'Capsula_4': { n: 0.42, d: 0.5, lambda: 0.05 }, // ZVI
    'Capsula_1': { n: 0.60, d: 0.3, lambda: 0.05 }, // biochar colonizado por micelio
    'Capsula_3': { n: 0.40, d: 4, lambda: 0.01 } // grava fina
};

export function conductivity({ n, d }) {
    return RHO_G_OVER_MU * n ** 3 * d ** 2 / (180 * (1 - n) ** 2);
}

// El espacio entre capas no opone resistencia y el agua lo cruza sin llenarlo.
const GAP_POROSITY = 0.03;

export class FilterModel {
    // segments: de arriba hacia abajo, { id, length } para una capa y { length } para un hueco.
    constructor({ segments, bedArea, pondArea, maxPondHeight, maxInflow }) {
        this.bedArea = bedArea;
        this.pondArea = pondArea;
        this.maxPondHeight = maxPondHeight;
        this.maxInflow = maxInflow;
        this.segments = segments.map(s => {
            const material = s.id ? MATERIALS[s.id] : null;
            const n = material ? material.n : GAP_POROSITY;
            return {
                ...s,
                n,
                lambda: material ? material.lambda : 0,
                present: true,
                resistance: material ? s.length / conductivity(material) : 0,
                poreVolume: n * bedArea * s.length
            };
        });
        this.running = false;
        this.pondHeight = 0;
        this.bedVolume = 0;
        this.inflow = 0;
        this.bedFlow = 0;
        this.outflow = 0;
        this.volumeIn = 0;
        this.volumeOut = 0;
    }

    get poreVolumeTotal() {
        return this.segments.reduce((sum, s) => sum + s.poreVolume, 0);
    }

    // Avanza dt segundos en pasos pequeños: la válvula es rígida frente al cuadro de 60 Hz.
    step(dt) {
        if (!this.running) return;
        const steps = Math.max(1, Math.ceil(dt / 0.002));
        for (let i = 0; i < steps; i++) this.substep(dt / steps);
    }

    substep(dt) {
        const valve = Math.min(1, Math.max(0, (this.maxPondHeight - this.pondHeight) / 1.5));
        const inflow = this.maxInflow * valve;

        const { depth, resistance, saturated } = this.wettedColumn();
        const capacity = resistance > 0
            ? this.bedArea * (this.pondHeight + depth) / resistance
            : Infinity;
        // no puede pasar más de lo que llega más lo que queda en el cuello
        const available = inflow + this.pondHeight * this.pondArea / dt;
        const bedFlow = Math.min(capacity, available);

        this.pondHeight = Math.max(0, this.pondHeight + (inflow - bedFlow) * dt / this.pondArea);
        this.volumeIn += inflow * dt;

        // Mientras el lecho se llena, el agua se queda en sus poros; ya lleno, todo lo que pasa sale.
        let outflow = 0;
        if (saturated) {
            outflow = bedFlow;
            this.volumeOut += bedFlow * dt;
        } else {
            const room = this.poreVolumeTotal - this.bedVolume;
            const stored = Math.min(room, bedFlow * dt);
            this.bedVolume += stored;
            outflow = Math.max(0, bedFlow - stored / dt);
            this.volumeOut += bedFlow * dt - stored;
        }

        this.inflow = inflow;
        this.bedFlow = bedFlow;
        this.outflow = outflow;
    }

    // Altura de columna mojada (la que empuja) y resistencia acumulada hasta el frente.
    wettedColumn() {
        let remaining = this.bedVolume;
        let depth = 0;
        let resistance = 0;
        for (const s of this.segments) {
            const fraction = s.poreVolume > 0 ? Math.min(1, remaining / s.poreVolume) : 1;
            depth += s.length * fraction;
            if (s.present) resistance += s.resistance * fraction;
            if (fraction < 1) return { depth, resistance, saturated: false };
            remaining -= s.poreVolume;
        }
        return { depth, resistance, saturated: true };
    }

    // Una capa extraída deja de frenar y de retener. Si seguía seca, el agua ya no
    // tiene poros que llenar ahí y cruza el hueco directamente.
    setLayerPresent(id, present) {
        const s = this.segments.find(seg => seg.id === id);
        s.present = present;
        const dryBefore = this.segments.slice(0, this.segments.indexOf(s))
            .reduce((sum, seg) => sum + seg.poreVolume, 0);
        const wetInLayer = Math.max(0, this.bedVolume - dryBefore);
        const full = MATERIALS[id].n * this.bedArea * s.length;
        // Al volver recupera sus poros: una capa mojada ya los tiene llenos y una seca los llena.
        s.poreVolume = present ? full : Math.min(full, Math.max(wetInLayer, GAP_POROSITY * this.bedArea * s.length));
    }

    // Tiempo que tarda el agua en cruzar una capa con el caudal dado: nᵢ·Lᵢ·A / Q (s).
    residenceTime(id, flow = this.bedFlow) {
        const s = this.segments.find(seg => seg.id === id);
        return flow > 0 ? s.poreVolume / flow : Infinity;
    }

    // Fracción de sólidos que queda al salir de cada segmento (1 = agua de entrada).
    turbidityProfile() {
        let c = 1;
        return this.segments.map(s => {
            if (s.present) c *= Math.exp(-s.lambda * s.length);
            return c;
        });
    }
}
