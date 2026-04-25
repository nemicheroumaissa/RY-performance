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
        const doc = new PDFDocument({ margin: 48, size: 'A4' });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(20).text('RY Performance', { align: 'center' });
        doc.moveDown(0.3);
        doc.fontSize(11).fillColor('#444').text('Synthèse de devis / réservation', { align: 'center' });
        doc.fillColor('#000');
        doc.moveDown(1.2);

        doc.fontSize(12).text(`Réf. réservation : ${data.reservationId}`, { continued: false });
        doc.moveDown(0.6);
        doc.fontSize(11).text(`Client : ${data.clientNom || '—'}`);
        doc.text(`Téléphone : ${data.clientTelephone || '—'}`);
        if (data.clientEmail) doc.text(`Email : ${data.clientEmail}`);
        doc.moveDown(0.4);
        doc.text(`Véhicule : ${data.modele || '—'} ${data.annee ? `(${data.annee})` : ''}`);

        doc.moveDown(0.8);
        doc.fontSize(12).text('Services', { underline: true });
        doc.moveDown(0.3);
        doc.fontSize(10);
        if (data.servicesLines && data.servicesLines.length) {
            data.servicesLines.forEach((line) => {
                doc.text(`• ${line}`, { indent: 8 });
            });
        } else {
            doc.text('—', { indent: 8 });
        }

        doc.moveDown(0.8);
        if (data.delaiRemise && String(data.delaiRemise).trim()) {
            doc.fontSize(11).text('Délai de la remise', { underline: true });
            doc.moveDown(0.2);
            doc.fontSize(10).text(String(data.delaiRemise).trim(), { indent: 8 });
            doc.moveDown(0.6);
        }

        doc.fontSize(11).text('Montants (DZD)', { underline: true });
        doc.moveDown(0.3);
        doc.fontSize(10);
        doc.text(`Prix de base : ${formatNum(data.prixBase)}`);
        doc.text(`Remise : ${formatNum(data.remise)}`);
        doc.fontSize(12).text(`Prix final : ${formatNum(data.prixFinal)}`, { continued: false });

        doc.moveDown(2);
        doc.fontSize(9).fillColor('#666').text('Document généré automatiquement par RY Performance.', { align: 'center' });

        doc.end();
    });
}

function formatNum(n) {
    const x = Number(n) || 0;
    return `${x.toLocaleString('fr-FR')} DZD`;
}

module.exports = { buildQuotePdfBuffer };
