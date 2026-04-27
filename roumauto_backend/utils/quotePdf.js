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
 * @param {string} [data.delaiRemise]
 * @param {string|number} data.reservationId
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
           .text('Devis & Confirmation de réservation', MARGIN, 52, { align: 'left' });

        // Numéro de réservation en haut à droite
        doc.fillColor(WHITE)
           .fontSize(10)
           .font('Helvetica-Bold')
           .text(`Réf. #${data.reservationId}`, MARGIN, 35, { align: 'right', width: COL_W });

        const CONTENT_BOTTOM = doc.page.height - 80;
        let y = 104;

        // ── Ligne de séparation colorée fine ─────────────────────
        doc.rect(MARGIN, y, COL_W, 2).fill(PURPLE_L);
        y += 12;

        // ── Bloc informations client ──────────────────────────────
        sectionTitle(doc, 'Informations client', MARGIN, y, COL_W, PURPLE, GRAY_L);
        y += 28;

        const clientLines = [
            ['Nom',       data.clientNom       || '—'],
            ['Téléphone', data.clientTelephone  || '—'],
            ...(data.clientEmail ? [['Email', data.clientEmail]] : []),
            ['Véhicule',  `${data.modele || '—'}${data.annee ? '  (' + data.annee + ')' : ''}`],
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
        sectionTitle(doc, 'Services demandés', MARGIN, y, COL_W, PURPLE, GRAY_L);
        y += 28;

        const lines = data.servicesLines && data.servicesLines.length
            ? data.servicesLines
            : ['—'];

        const maxServices = 8;
        const renderedLines = lines.slice(0, maxServices);
        renderedLines.forEach((line, i) => {
            // Alternance légère de fond
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

        // ── Bloc remise/délai (si applicable) ────────────────────
        if (data.delaiRemise && String(data.delaiRemise).trim()) {
            sectionTitle(doc, 'Conditions de la remise', MARGIN, y, COL_W, PURPLE, GRAY_L);
            y += 28;
            doc.font('Helvetica').fontSize(10).fillColor(GRAY_D)
               .text(String(data.delaiRemise).trim(), MARGIN + 10, y, { width: COL_W - 20 });
            y += doc.heightOfString(String(data.delaiRemise).trim(), { width: COL_W - 20 }) + 12;
        }

        // ── Bloc récapitulatif des prix ───────────────────────────
        if (y > CONTENT_BOTTOM - 90) y = CONTENT_BOTTOM - 90;
        sectionTitle(doc, 'Récapitulatif des montants', MARGIN, y, COL_W, PURPLE, GRAY_L);
        y += 28;

        const prixBase  = Number(data.prixBase)  || 0;
        const remise    = Number(data.remise)     || 0;
        const prixFinal = Number(data.prixFinal)  || 0;

        if (prixBase > 0 && remise > 0) {
            priceRow(doc, 'Prix de base',  formatNum(prixBase),  MARGIN, y, COL_W, GRAY_D, GRAY_M, false);
            y += 20;
        }

        if (remise > 0) {
            priceRow(doc, 'Remise client', '- ' + formatNum(remise), MARGIN, y, COL_W, GREEN, GRAY_M, false);
            y += 20;
        }

        // Ligne séparatrice avant total (uniquement s'il y a un détail de remise)
        if (remise > 0) {
            doc.rect(MARGIN + 10, y, COL_W - 20, 1).fill('#dddddd');
            y += 8;
        }

        // Total en évidence
        doc.rect(MARGIN, y, COL_W, 30).fill(PURPLE).stroke();
        doc.font('Helvetica-Bold').fontSize(12).fillColor(WHITE)
           .text('PRIX FINAL', MARGIN + 12, y + 8, { continued: false, width: COL_W / 2 });
        doc.font('Helvetica-Bold').fontSize(14).fillColor(WHITE)
           .text(prixFinal > 0 ? formatNum(prixFinal) : 'À définir par l\'administrateur', MARGIN, y + 7, { align: 'right', width: COL_W - 12 });

        y += 42;

        // ── Note de bas de page ───────────────────────────────────
        doc.rect(0, doc.page.height - 44, PAGE_W, 44).fill(GRAY_L);
        doc.font('Helvetica').fontSize(8).fillColor(GRAY_M)
           .text(
               'Document généré automatiquement par RY Performance · Ce devis est fourni à titre indicatif.',
               MARGIN,
               doc.page.height - 28,
               { align: 'center', width: COL_W }
           );

        doc.end();
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Bloc titre de section avec fond coloré */
function sectionTitle(doc, text, x, y, width, bgColor, bgLight) {
    doc.rect(x, y, width, 24).fill(bgLight);
    doc.rect(x, y, 4, 24).fill(bgColor);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(bgColor)
       .text(text.toUpperCase(), x + 12, y + 7, { width: width - 20 });
}

/** Ligne de prix (label gauche, valeur droite) */
function priceRow(doc, label, value, x, y, width, valueColor, labelColor) {
    doc.font('Helvetica').fontSize(10).fillColor(labelColor)
       .text(label, x + 10, y, { continued: false, width: width / 2 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(valueColor)
       .text(value, x, y, { align: 'right', width: width - 10 });
}

function formatNum(n) {
    const x = Number(n) || 0;
    const s = Math.round(x).toString();
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' DZD';
}

module.exports = { buildQuotePdfBuffer };