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
        // autoFirstPage:false + on gère tout manuellement
        const doc = new PDFDocument({ margin: 44, size: 'A4', autoFirstPage: false });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end',  () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Ouvre UNE seule page
        doc.addPage();

        const PAGE_W   = doc.page.width;   // 595.28
        const PAGE_H   = doc.page.height;  // 841.89
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

        // Titre gauche
        doc.fillColor(WHITE)
           .fontSize(24)
           .font('Helvetica-Bold')
           .text('RY Performance', MARGIN, 22, { lineBreak: false });

        // Sous-titre gauche
        doc.fillColor('rgba(255,255,255,0.7)')
           .fontSize(10)
           .font('Helvetica')
           .text('Devis & Confirmation de reservation', MARGIN, 52, { lineBreak: false });

        // Ref droite — on calcule la position X manuellement
        const refText = `Ref. #${data.reservationId}`;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(WHITE);
        const refW = doc.widthOfString(refText);
        doc.text(refText, PAGE_W - MARGIN - refW, 38, { lineBreak: false });

        // ── Reset curseur après le header ────────────────────────
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
               .text(label.toUpperCase(), MARGIN + 10, y, { width: 105, lineBreak: false });
            doc.font('Helvetica').fontSize(10).fillColor(GRAY_D)
               .text(value, MARGIN + 125, y, { width: COL_W - 130, lineBreak: false });
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
               .text(line, MARGIN + 26, y, { width: COL_W - 30, lineBreak: false });
            y += 18;
        });
        if (lines.length > maxServices) {
            doc.font('Helvetica-Oblique').fontSize(9).fillColor(GRAY_M)
               .text(`+ ${lines.length - maxServices} autre(s) service(s)`, MARGIN + 26, y, { width: COL_W - 30, lineBreak: false });
            y += 16;
        }

        y += 6;

        // ── Bloc remise/délai ─────────────────────────────────────
        if (data.delaiRemise && String(data.delaiRemise).trim()) {
            sectionTitle(doc, 'Conditions de la remise', MARGIN, y, COL_W, PURPLE, GRAY_L);
            y += 28;

            const delaiText = String(data.delaiRemise).trim();
            // Calcule la hauteur AVANT de dessiner pour ne pas déborder
            doc.font('Helvetica').fontSize(10).fillColor(GRAY_D);
            const delaiH = doc.heightOfString(delaiText, { width: COL_W - 20 });
            doc.text(delaiText, MARGIN + 10, y, { width: COL_W - 20, lineBreak: true });
            y += delaiH + 12;
        }

        // ── Calculs prix ──────────────────────────────────────────
        const prixBase  = Math.round(Number(data.prixBase)  || 0);
        const prixFinal = Math.round(Math.min(Number(data.prixFinal) || 0, prixBase > 0 ? prixBase : Infinity));
        const remiseMontant = Math.max(0, prixBase - prixFinal);
        const remisePct = prixBase > 0 && remiseMontant > 0
            ? Math.round((remiseMontant / prixBase) * 10000) / 100
            : 0;

        // Hauteur nécessaire pour le récap prix
        let prixBlockH = 28; // titre section
        if (prixBase > 0) prixBlockH += 20;
        if (remisePct > 0) prixBlockH += 40;
        else if (remiseMontant > 0) prixBlockH += 20;
        if (remiseMontant > 0) prixBlockH += 9;
        prixBlockH += 30; // bandeau prix final

        // Footer height
        const FOOTER_H = 62;

        // Si le bloc prix ne rentre pas, on le pousse juste au-dessus du footer
        const minY = PAGE_H - FOOTER_H - prixBlockH - 10;
        if (y > minY) y = minY;

        // ── Bloc récapitulatif des prix ───────────────────────────
        sectionTitle(doc, 'Recapitulatif des montants', MARGIN, y, COL_W, PURPLE, GRAY_L);
        y += 28;

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
        doc.rect(MARGIN, y, COL_W, 30).fill(PURPLE);

        // Label gauche
        doc.font('Helvetica-Bold').fontSize(12).fillColor(WHITE)
           .text('PRIX FINAL', MARGIN + 12, y + 8, { lineBreak: false });

        // Valeur droite — calcul manuel de X
        const prixStr = prixFinal > 0 ? formatNum(prixFinal) : "A definir par l'administrateur";
        doc.font('Helvetica-Bold').fontSize(14).fillColor(WHITE);
        const prixStrW = doc.widthOfString(prixStr);
        doc.text(prixStr, PAGE_W - MARGIN - prixStrW, y + 7, { lineBreak: false });

        // ── Footer ────────────────────────────────────────────────
        const emissionStr = formatEmissionDate(
            data.dateEmission !== undefined && data.dateEmission !== null && String(data.dateEmission).trim() !== ''
                ? data.dateEmission
                : new Date()
        );

        const FOOTER_Y = PAGE_H - FOOTER_H;

        // Fond footer
        doc.rect(0, FOOTER_Y, PAGE_W, FOOTER_H).fill(GRAY_L);
        // Barre décorative violette en haut du footer
        doc.rect(0, FOOTER_Y, PAGE_W, 3).fill(PURPLE);

        // Date d'émission — à gauche
        if (emissionStr) {
            doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PURPLE)
               .text("Date d'emission :", MARGIN, FOOTER_Y + 10, { lineBreak: false });
            doc.font('Helvetica').fontSize(9).fillColor(GRAY_D)
               .text(emissionStr, MARGIN, FOOTER_Y + 23, { lineBreak: false });
        }

        // Mention légale — à droite (deux lignes manuelles)
        const mention1 = 'Document genere automatiquement par RY Performance';
        const mention2 = 'Ce devis est fourni a titre indicatif.';
        doc.font('Helvetica').fontSize(7.5).fillColor(GRAY_M);
        const m1W = doc.widthOfString(mention1);
        const m2W = doc.widthOfString(mention2);
        doc.text(mention1, PAGE_W - MARGIN - m1W, FOOTER_Y + 10, { lineBreak: false });
        doc.text(mention2, PAGE_W - MARGIN - m2W, FOOTER_Y + 22, { lineBreak: false });

        doc.end();
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sectionTitle(doc, text, x, y, width, bgColor, bgLight) {
    doc.rect(x, y, width, 24).fill(bgLight);
    doc.rect(x, y, 4, 24).fill(bgColor);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(bgColor)
       .text(text.toUpperCase(), x + 12, y + 7, { width: width - 20, lineBreak: false });
}

function priceRow(doc, label, value, x, y, width, valueColor, labelColor) {
    doc.font('Helvetica').fontSize(10).fillColor(labelColor)
       .text(label, x + 10, y, { lineBreak: false });

    // Valeur alignée à droite : calcul manuel de X
    doc.font('Helvetica-Bold').fontSize(10).fillColor(valueColor);
    const vW = doc.widthOfString(value);
    doc.text(value, x + width - 10 - vW, y, { lineBreak: false });
}

function formatNum(n) {
    const x = Math.round(Number(n) || 0);
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' DZD';
}

function formatPercentLabel(pct) {
    const x = Math.round(Number(pct) * 100) / 100;
    if (!Number.isFinite(x) || x <= 0) return '0';
    return x % 1 === 0 ? String(x) : x.toFixed(2);
}

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