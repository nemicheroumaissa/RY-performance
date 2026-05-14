const PDFDocument = require('pdfkit');

/**
 * @param {object} data
 * @param {string} data.clientNom
 * @param {string} data.clientTelephone
 * @param {string} [data.clientEmail]
 * @param {string} [data.modele]
 * @param {string} [data.annee]
 * @param {string[]} data.servicesLines
 * @param {number} data.prixBase
 * @param {number} data.remise
 * @param {number} data.prixFinal
 * @param {number} [data.remisePercent]
 * @param {string} [data.delaiRemise]
 * @param {string|number} data.reservationId
 * @param {string|Date} [data.dateEmission]
 */
function buildQuotePdfBuffer(data) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 44, size: 'A4' });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end',  () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const PAGE_W   = doc.page.width;
        const MARGIN   = 44;
        const COL_W    = PAGE_W - MARGIN * 2;
        const PURPLE   = '#7B2D8B';
        const PURPLE_L = '#9b59b6';
        const GRAY_D   = '#333333';
        const GRAY_M   = '#666666';
        const GRAY_L   = '#f4f4f8';
        const WHITE    = '#ffffff';
        const GREEN    = '#27ae60';

        // ── Bandeau en-tête ──────────────────────────────────────
        doc.rect(0, 0, PAGE_W, 90).fill(PURPLE);

        doc.fillColor(WHITE)
           .fontSize(24)
           .font('Helvetica-Bold')
           .text('RY Performance', MARGIN, 22, { align: 'left' });

        doc.fillColor('rgba(255,255,255,0.7)')
           .fontSize(10)
           .font('Helvetica')
           .text('Devis & Confirmation de reservation', MARGIN, 52, { align: 'left' });

        // ── Numéro de réservation dans le header (sans date) ──────
        doc.fillColor(WHITE)
           .fontSize(10)
           .font('Helvetica-Bold')
           .text(`Ref. #${data.reservationId}`, MARGIN, 38, { align: 'right', width: COL_W });

        const CONTENT_BOTTOM = doc.page.height - 80;
        let y = 104;

        // ── Ligne de séparation ───────────────────────────────────
        doc.rect(MARGIN, y, COL_W, 2).fill(PURPLE_L);
        y += 12;

        // ── Bloc informations client ──────────────────────────────
        sectionTitle(doc, 'Informations client', MARGIN, y, COL_W, PURPLE, GRAY_L);
        y += 28;

        const clientLines = [
            ['Nom',       data.clientNom       || '-'],
            ['Telephone', data.clientTelephone  || '-'],
            ...(data.clientEmail ? [['Email', data.clientEmail]] : []),
            ['Vehicule',  `${data.modele || '-'}${data.annee ? '  (' + data.annee + ')' : ''}`],
        ];

        clientLines.forEach(([label, value]) => {
            doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY_M)
               .text(label.toUpperCase(), MARGIN + 10, y, { width: 105 });
            doc.font('Helvetica').fontSize(10).fillColor(GRAY_D)
               .text(value, MARGIN + 125, y, { width: COL_W - 130 });
            y += 16;
        });

        y += 6;

        // ── Bloc services ─────────────────────────────────────────
        sectionTitle(doc, 'Services demandes', MARGIN, y, COL_W, PURPLE, GRAY_L);
        y += 28;

        const lines = data.servicesLines && data.servicesLines.length
            ? data.servicesLines
            : ['-'];

        const maxServices = 8;
        const renderedLines = lines.slice(0, maxServices);
        renderedLines.forEach((line, i) => {
            if (i % 2 === 0) {
                doc.rect(MARGIN, y - 2, COL_W, 16).fill('#faf9fc');
            }
            doc.circle(MARGIN + 16, y + 6, 3).fill(PURPLE_L);
            doc.font('Helvetica').fontSize(9.8).fillColor(GRAY_D)
               .text(line, MARGIN + 26, y, { width: COL_W - 30 });
            y += 18;
        });
        if (lines.length > maxServices) {
            doc.font('Helvetica-Oblique').fontSize(9).fillColor(GRAY_M)
               .text(`+ ${lines.length - maxServices} autre(s) service(s)`, MARGIN + 26, y, { width: COL_W - 30 });
            y += 16;
        }

        y += 6;

        // ── Bloc remise/délai ─────────────────────────────────────
        if (data.delaiRemise && String(data.delaiRemise).trim()) {
            sectionTitle(doc, 'Conditions de la remise', MARGIN, y, COL_W, PURPLE, GRAY_L);
            y += 28;
            doc.font('Helvetica').fontSize(10).fillColor(GRAY_D)
               .text(String(data.delaiRemise).trim(), MARGIN + 10, y, { width: COL_W - 20 });
            y += doc.heightOfString(String(data.delaiRemise).trim(), { width: COL_W - 20 }) + 12;
        }

        // ── Bloc récapitulatif des prix ───────────────────────────
        if (y > CONTENT_BOTTOM - 90) y = CONTENT_BOTTOM - 90;
        sectionTitle(doc, 'Recapitulatif des montants', MARGIN, y, COL_W, PURPLE, GRAY_L);
        y += 28;

        const prixBase  = Math.round(Number(data.prixBase)  || 0);
        const prixFinal = Math.round(Math.min(Number(data.prixFinal) || 0, prixBase > 0 ? prixBase : Infinity));

        const remiseMontant = Math.max(0, prixBase - prixFinal);
        const remisePct = prixBase > 0 && remiseMontant > 0
            ? Math.round((remiseMontant / prixBase) * 10000) / 100
            : 0;

        if (prixBase > 0) {
            priceRow(doc, 'Prix de base', formatNum(prixBase), MARGIN, y, COL_W, GRAY_D, GRAY_M);
            y += 20;
        }

        if (remisePct > 0) {
            priceRow(
                doc,
                'Taux de remise fidelite',
                `- ${formatPercentLabel(remisePct)} %`,
                MARGIN, y, COL_W, GREEN, GRAY_M
            );
            y += 20;
            priceRow(
                doc,
                'Montant de la remise',
                `- ${formatNum(remiseMontant)}`,
                MARGIN, y, COL_W, GREEN, GRAY_M
            );
            y += 20;
        } else if (remiseMontant > 0) {
            priceRow(doc, 'Remise client', `- ${formatNum(remiseMontant)}`, MARGIN, y, COL_W, GREEN, GRAY_M);
            y += 20;
        }

        if (remiseMontant > 0) {
            doc.rect(MARGIN + 10, y, COL_W - 20, 1).fill('#dddddd');
            y += 8;
        }

        // ── Bandeau prix final ────────────────────────────────────
        doc.rect(MARGIN, y, COL_W, 30).fill(PURPLE).stroke();
        doc.font('Helvetica-Bold').fontSize(12).fillColor(WHITE)
           .text('PRIX FINAL', MARGIN + 12, y + 8, { continued: false, width: COL_W / 2 });
        doc.font('Helvetica-Bold').fontSize(14).fillColor(WHITE)
           .text(
               prixFinal > 0 ? formatNum(prixFinal) : "A definir par l'administrateur",
               MARGIN, y + 7, { align: 'right', width: COL_W - 12 }
           );

        // ── Footer : date d'émission + mention légale ─────────────
        const emissionStr = formatEmissionDate(
            data.dateEmission !== undefined && data.dateEmission !== null && String(data.dateEmission).trim() !== ''
                ? data.dateEmission
                : new Date()
        );

        const FOOTER_H = 62;
        const FOOTER_Y = doc.page.height - FOOTER_H;

        // Fond footer
        doc.rect(0, FOOTER_Y, PAGE_W, FOOTER_H).fill(GRAY_L);
        // Barre décorative violette en haut du footer
        doc.rect(0, FOOTER_Y, PAGE_W, 3).fill(PURPLE);

        // Date d'émission — à gauche, mise en valeur
        if (emissionStr) {
            doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PURPLE)
               .text("Date d'emission :", MARGIN, FOOTER_Y + 10);
            doc.font('Helvetica').fontSize(9).fillColor(GRAY_D)
               .text(emissionStr, MARGIN, FOOTER_Y + 23);
        }

        // Mention légale — à droite
        doc.font('Helvetica').fontSize(7.5).fillColor(GRAY_M)
           .text(
               'Document genere automatiquement par RY Performance\nCe devis est fourni a titre indicatif.',
               MARGIN, FOOTER_Y + 10,
               { align: 'right', width: COL_W, lineGap: 3 }
           );

        doc.end();
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sectionTitle(doc, text, x, y, width, bgColor, bgLight) {
    doc.rect(x, y, width, 24).fill(bgLight);
    doc.rect(x, y, 4, 24).fill(bgColor);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(bgColor)
       .text(text.toUpperCase(), x + 12, y + 7, { width: width - 20 });
}

function priceRow(doc, label, value, x, y, width, valueColor, labelColor) {
    doc.font('Helvetica').fontSize(10).fillColor(labelColor)
       .text(label, x + 10, y, { continued: false, width: width / 2 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(valueColor)
       .text(value, x, y, { align: 'right', width: width - 10 });
}

// Espace normale ASCII comme séparateur de milliers — pas d'espace fine \u202f
function formatNum(n) {
    const x = Math.round(Number(n) || 0);
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' DZD';
}

function formatPercentLabel(pct) {
    const x = Math.round(Number(pct) * 100) / 100;
    if (!Number.isFinite(x) || x <= 0) return '0';
    return x % 1 === 0 ? String(x) : x.toFixed(2);
}

// Formatage manuel sans Intl — aucun caractère spécial incompatible PDFKit
function formatEmissionDate(isoOrDate) {
    if (isoOrDate == null || isoOrDate === '') return '';
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) return '';
    const months = [
        'janvier','fevrier','mars','avril','mai','juin',
        'juillet','aout','septembre','octobre','novembre','decembre'
    ];
    const day   = d.getDate();
    const month = months[d.getMonth()];
    const year  = d.getFullYear();
    const hh    = String(d.getHours()).padStart(2, '0');
    const mm    = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${month} ${year} a ${hh}:${mm}`;
}

module.exports = { buildQuotePdfBuffer };