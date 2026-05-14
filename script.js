// ============================================
// ROUMAUTO PRO - SCRIPT.JS
// Version FINALE CONSOLIDÉE
// Fixes : statut Reçu/Vu + scroll bas + shadows
// ============================================

// ============================================
// CONFIG API
// ============================================
function getRoumautoApiOrigin() {
    if (typeof window === 'undefined') return 'http://127.0.0.1:5000';
    if (window.ROUMAUTO_API_ORIGIN) return String(window.ROUMAUTO_API_ORIGIN).replace(/\/$/, '');
    const { protocol, hostname, port } = window.location;
    if ((protocol === 'http:' || protocol === 'https:') && String(port) === '5000') {
        return `${protocol}//${hostname}:${port}`;
    }
    return 'http://127.0.0.1:5000';
}

const API_ORIGIN = getRoumautoApiOrigin();
const API_URL =
    typeof window !== 'undefined' &&
    (window.location.protocol === 'http:' || window.location.protocol === 'https:') &&
    String(window.location.port) === '5000'
        ? '/api'
        : `${API_ORIGIN}/api`;

function mediaFileUrl(filePath) {
    if (!filePath) return '';
    const p = String(filePath).replace(/^\/+/, '');
    if (typeof window !== 'undefined' && String(window.location.port) === '5000') return '/' + p;
    return `${API_ORIGIN}/${p}`;
}

// ============================================
// VARIABLES GLOBALES
// ============================================
let currentBookingData   = null;
let selectedServicesData = [];
let socket               = null;
let currentClient        = null;
let currentConversationId = null;
let mediaRecorder        = null;
let audioChunks          = [];
let isRecording          = false;
let recordingStartTime   = 0;

// ============================================
// UTILITAIRES MODAL
// ============================================
function setModalVisible(modalId, visible) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = visible ? 'flex' : 'none';
    document.body.style.overflow = visible ? 'hidden' : 'auto';
}

function closeModal(id) { setModalVisible(id, false); }
window.closeModal = closeModal;

// ============================================
// STATUTS MESSAGES
// ============================================

/**
 * Applique le chip de statut sur un span :
 *   read      → "Vu"
 *   delivered → "Reçu"
 *   sent      → "Envoyé"
 */
function applyMessageStatusChip(statusSpan, status) {
    if (!statusSpan) return;
    const normalized = status === 'read' ? 'read' : (status === 'delivered' ? 'delivered' : 'sent');
    if (normalized === 'read') {
        statusSpan.textContent = 'Vu';
        statusSpan.className   = 'msg-status msg-status-read';
    } else if (normalized === 'delivered') {
        statusSpan.textContent = 'Reçu';
        statusSpan.className   = 'msg-status msg-status-delivered';
    } else {
        statusSpan.textContent = 'Env.';
        statusSpan.className   = 'msg-status msg-status-sent';
    }
}

function updateMessageStatusesInDom(messageIds, status) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) return;
    messageIds.forEach((id) => {
        // Même logique que admin.js : sélecteur avec conteneur parent + String(id)
        const statusSpan = document.querySelector(`.msg-meta .msg-status[data-message-id="${id}"]`);
        applyMessageStatusChip(statusSpan, status);
    });
}

/**
 * Marque les messages de l'admin comme "read" côté client.
 * Appelé uniquement quand le widget chat est ouvert et visible.
 * 
 * IMPORTANT : le client NE marque PAS ses propres messages comme delivered/read.
 * C'est l'admin qui appelle markDelivered('admin') → le backend émet
 * messages_status_updated via socket → le client reçoit et met à jour son DOM.
 */
async function syncConversationStatuses(viewerType, markRead = false) {
    if (!currentConversationId) return;
    if (!markRead) return; // ✅ Le client n'appelle plus markDelivered
    try {
        const readRes  = await fetch(`${API_URL}/chat/conversations/${currentConversationId}/mark-read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ viewerType })
        });
        const readData = await readRes.json();
        // Ici les IDs retournés sont ceux des messages de l'ADMIN
        // → pas de statusSpan côté client pour ces messages → rien à mettre à jour dans le DOM client
        // → mais le backend émet socket 'messages_status_updated' vers l'admin
        //   pour que l'admin voie "Vu" sur ses propres messages ✅
    } catch (err) {
        console.error('Erreur sync statuts:', err);
    }
}

// ============================================
// DONNÉES STATIQUES
// ============================================

const SERVICE_NAMES = {
    'peinture': 'Peinture Automobile',
    'vinyl':    'Covering Vinyl Complet',
    'bodykit':  'Kit Carrosserie',
    'rims':     'Jantes Customization',
    'tint':     'Vitres Teintées',
    'lights':   'Phares/Feux Teintés',
    'decals':   'Stickers & Graphics',
    'ceramic':  'Coating Céramique',
    'ppf':      'PPF Pare-chocs'
};

const galleryProjects = {
    1: {
        title: 'Peinture Complète', vehicle: 'Renault Clio 4', duration: '5 jours',
        services: 'Peinture complète, Vernis protecteur',
        description: 'Transformation complète avec peinture métallisée gris anthracite. Préparation minutieuse de la carrosserie, application de 3 couches et vernis UV.',
        beforeImg: 'clio4av.png', afterImg: 'clio4ap.png'
    },
    2: {
        title: 'Covering Vinyl Matt', vehicle: 'Volkswagen Golf 7 GTI', duration: '3 jours',
        services: 'Covering complet, Film 3M',
        description: "Application de film vinyl matt noir sur toute la carrosserie. Protection complète de la peinture d'origine avec finition premium.",
        beforeImg: 'golf7av.png', afterImg: 'golf7ap.png'
    },
    3: {
        title: 'Kit Carrosserie Sport', vehicle: 'Seat Leon FR', duration: '7 jours',
        services: 'Kit carrosserie, Peinture assortie',
        description: "Installation complète d'un bodykit sport : spoiler avant, jupes latérales, diffuseur arrière. Peinture assortie à la couleur d'origine.",
        beforeImg: 'leonav.png', afterImg: 'leonap.png'
    },
    4: {
        title: 'Jantes Customization', vehicle: 'Volkswagen Polo GTI', duration: '2 jours',
        services: 'Peinture jantes, Polissage',
        description: 'Peinture des jantes en noir brillant avec contours rouges. Polissage et protection céramique pour une durabilité maximale.',
        beforeImg: 'poloav.png', afterImg: 'poloap.png'
    },
    5: {
        title: 'Vitres Teintées Premium', vehicle: 'Volkswagen Tiguan', duration: '1 jour',
        services: 'Film solaire 20%, Vitres latérales et arrière',
        description: 'Application de film solaire haute qualité 20% sur vitres latérales et lunette arrière. Protection UV et intimité garantie.',
        beforeImg: 'tiguanav.png', afterImg: 'tiguanap.png'
    },
    6: {
        title: 'Coating Céramique', vehicle: 'Audi A3 Sportback', duration: '2 jours',
        services: 'Coating 9H, Polissage complet',
        description: 'Traitement céramique complet avec polissage préalable. Protection longue durée contre rayures, UV et intempéries. Brillance extrême.',
        beforeImg: 'audiav.png', afterImg: 'audiap.png'
    }
};

const servicesData = {
    1: {
        title: 'Peinture Automobile', image: 'p.jpg',
        price: 'À partir de 50,000 DA', duration: "5-10 jours selon l'état du véhicule",
        description: 'Peinture complète de votre véhicule avec des finitions professionnelles. Nous utilisons des peintures de haute qualité avec garantie longue durée.',
        types: ['Peinture complète (toute la carrosserie)', 'Peinture partielle (capot, aile, portière)', 'Retouche localisée (rayures, impacts)', 'Peinture métallisée ou nacrée', 'Peinture mate (finition tendance)', 'Vernis anti-rayures haute résistance']
    },
    2: {
        title: 'Covering Vinyl Complet', image: 'c.jpg',
        price: 'À partir de 80,000 DA', duration: '3-5 jours',
        description: "Installation professionnelle de film vinyle haute qualité sur l'ensemble de votre véhicule. Protection de la peinture d'origine.",
        types: ['Vinyl mat (noir, gris, blanc, couleurs)', 'Vinyl brillant (toutes couleurs)', 'Vinyl carbone (3D texturé)', 'Vinyl chromé (effet miroir)', 'Vinyl satiné (finition élégante)', 'Covering partiel (capot, toit, rétros)']
    },
    3: {
        title: 'Installation Kit Carrosserie', image: 'k.jpg',
        price: 'À partir de 120,000 DA', duration: '5-7 jours',
        description: 'Pose professionnelle de kits carrosserie sport pour donner un look agressif et moderne à votre véhicule.',
        types: ['Spoiler avant (pare-chocs sport)', 'Jupes latérales (bas de caisse)', 'Diffuseur arrière', 'Becquet de toit ou coffre', "Élargisseurs d'ailes", 'Kit complet (avant + côtés + arrière)']
    },
    4: {
        title: 'Personnalisation Jantes', image: 'j.jpg',
        price: 'À partir de 40,000 DA', duration: '2-3 jours',
        description: 'Customisation complète de vos jantes avec peinture, polissage ou finitions spéciales.',
        types: ['Peinture couleur unie (noir, blanc, gris, rouge...)', 'Peinture bi-ton (jante + contours)', 'Polissage haute brillance', 'Finition mate ou satinée', 'Effet chromé ou gunmetal', 'Protection céramique jantes']
    },
    5: {
        title: 'Vitres Teintées', image: 'g.jpg',
        price: 'À partir de 15,000 DA', duration: '1 jour',
        description: "Application de film solaire haute qualité pour vos vitres. Protection UV jusqu'à 99%.",
        types: ['Teinte 5% (très foncée)', 'Teinte 20% (foncée - recommandée)', 'Teinte 35% (moyenne)', 'Teinte 50% (légère)', 'Film anti-reflet pare-brise', 'Film dégradé (top strip)']
    },
    6: {
        title: 'Teinte Phares/Feux', image: 'car.jpg',
        price: 'À partir de 20,000 DA', duration: '1 jour',
        description: 'Personnalisation de vos phares avant et feux arrière avec films teintés professionnels.',
        types: ['Phares avant (teinte légère)', 'Feux arrière (rouge foncé, noir)', 'Clignotants (orange, transparent)', 'Feux de brouillard', 'Combinaison complète avant + arrière', 'Protection transparente anti-rayures']
    },
    7: {
        title: 'Stickers & Graphics', image: 'r.jpg',
        price: 'À partir de 25,000 DA', duration: '1-3 jours selon complexité',
        description: 'Création et pose de stickers personnalisés, bandes racing, logos et designs sur-mesure.',
        types: ['Bandes racing (capot, toit, côtés)', 'Stickers latéraux personnalisés', 'Logos et textes (noms, slogans)', 'Design complet (wrapping graphique)', 'Stickers rétroviseurs et poignées', 'Numéros de course et sponsors']
    },
    8: {
        title: 'Coating Céramique', image: 'z.jpg',
        price: 'À partir de 60,000 DA', duration: '2 jours',
        description: 'Traitement céramique haute technologie pour une protection longue durée de votre carrosserie.',
        types: ['Coating 9H (protection maximale)', 'Coating hybride (céramique + cire)', 'Traitement vitres (effet pluie)', 'Protection jantes (anti-poussière)', 'Traitement plastiques extérieurs', 'Pack complet (carrosserie + vitres + jantes)']
    },
    9: {
        title: 'PPF Pare-chocs Avant', image: 't.png',
        price: 'À partir de 45,000 DA', duration: '1-2 jours',
        description: 'Installation de film de protection transparent (Paint Protection Film) sur pare-chocs avant.',
        types: ['PPF pare-chocs complet', 'PPF capot (protection anti-impacts)', 'PPF rétroviseurs', 'PPF seuils de portes', 'PPF arches de roues', 'Pack protection complète avant']
    }
};

// ============================================
// INITIALISATION
// ============================================
document.addEventListener('DOMContentLoaded', function () {
    console.log('🚗 RY Performance - Initialisation...');
    initNavigation();
    initFAQ();
    initServiceSelector();
    initFormSubmission();
    initAnimations();
    initScrollIndicator();
    initChatSystem();
    checkClientAuth();
});

// ============================================
// NAVIGATION
// ============================================
function initNavigation() {
    const navToggle = document.getElementById('nav-toggle');
    const navMenu   = document.getElementById('nav-menu');
    if (!navToggle || !navMenu) return;

    navToggle.addEventListener('click', () => {
        navMenu.classList.toggle('active');
        navToggle.classList.toggle('active');
    });

    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', function () {
            navMenu.classList.remove('active');
            navToggle.classList.remove('active');
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            this.classList.add('active');
        });
    });

    const sections = document.querySelectorAll('section[id]');
    window.addEventListener('scroll', () => {
        let current = 'home';
        sections.forEach(section => {
            if (window.scrollY >= section.offsetTop - 100) current = section.getAttribute('id');
        });
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === '#' + current) link.classList.add('active');
        });
    });
}

// ============================================
// FAQ
// ============================================
function initFAQ() {
    document.querySelectorAll('.faq-item').forEach(item => {
        const question = item.querySelector('.faq-question');
        const answer   = item.querySelector('.faq-answer');
        if (answer) answer.style.maxHeight = '0px';
        question.addEventListener('click', () => {
            item.classList.toggle('active');
            answer.style.maxHeight = item.classList.contains('active') ? answer.scrollHeight + 'px' : '0px';
        });
    });
}

// ============================================
// GALERIE - MODAL AVANT/APRÈS
// ============================================
function openGalleryModal(projectId) {
    const project = galleryProjects[projectId];
    if (!project) return;
    document.getElementById('gallery-modal-title').textContent    = project.title;
    document.getElementById('gallery-modal-desc').textContent     = project.description;
    document.getElementById('gallery-modal-vehicle').textContent  = project.vehicle;
    document.getElementById('gallery-modal-duration').textContent = project.duration;
    document.getElementById('gallery-modal-services').textContent = project.services;
    document.getElementById('gallery-before-img').src             = project.beforeImg;
    document.getElementById('gallery-after-img').src              = project.afterImg;
    setModalVisible('gallery-modal', true);
}
window.openGalleryModal = openGalleryModal;

// ============================================
// SERVICES - MODAL DÉTAILS
// ============================================
function openServiceModal(serviceId) {
    const service = servicesData[serviceId];
    if (!service) return;
    document.getElementById('service-modal-title').textContent    = service.title;
    document.getElementById('service-modal-img').src              = service.image;
    document.getElementById('service-modal-desc').textContent     = service.description;
    document.getElementById('service-modal-duration').textContent = service.duration;
    document.getElementById('service-modal-price').textContent    = service.price;
    const typesList = document.getElementById('service-modal-types');
    typesList.innerHTML = service.types.map(type => `<li>${type}</li>`).join('');
    setModalVisible('service-modal', true);
}
window.openServiceModal = openServiceModal;

// ============================================
// SÉLECTION SERVICES
// ============================================
function initServiceSelector() {
    const btn        = document.getElementById('select-services-btn');
    const confirmBtn = document.getElementById('confirm-services');
    if (btn)        btn.onclick        = () => setModalVisible('services-modal', true);
    if (confirmBtn) confirmBtn.onclick = () => { updateSelectedServicesDisplay(); closeModal('services-modal'); };
}

function updateSelectedServicesDisplay() {
    const checkboxes    = document.querySelectorAll('#services-modal input[name="services"]:checked');
    const displayText   = document.getElementById('selected-services-display');
    const tagsContainer = document.getElementById('selected-services-tags');
    selectedServicesData = [];
    tagsContainer.innerHTML = '';

    if (checkboxes.length === 0) {
        displayText.textContent = 'Cliquez pour sélectionner les services';
        displayText.style.color = 'var(--text-gray)';
        return;
    }

    displayText.textContent = checkboxes.length + ' service(s) sélectionné(s)';
    displayText.style.color = 'var(--primary-color)';

    checkboxes.forEach(checkbox => {
        const serviceValue = checkbox.value;
        const serviceName  = SERVICE_NAMES[serviceValue] || serviceValue;
        const servicePrice = parseInt(checkbox.getAttribute('data-price')) || 0;
        selectedServicesData.push({ value: serviceValue, name: serviceName, price: servicePrice });

        const tag = document.createElement('div');
        tag.className = 'service-tag';
        tag.innerHTML = `<span>${serviceName}</span><span class="remove-tag" data-service="${serviceValue}">×</span>`;
        tagsContainer.appendChild(tag);
    });

    document.querySelectorAll('.remove-tag').forEach(btn => {
        btn.addEventListener('click', function () {
            const cb = document.querySelector('#services-modal input[value="' + this.dataset.service + '"]');
            if (cb) cb.checked = false;
            updateSelectedServicesDisplay();
        });
    });
}

// ============================================
// FORMULAIRE RÉSERVATION
// ============================================
function initFormSubmission() {
    const form = document.getElementById('booking-form');
    if (form) form.addEventListener('submit', handleBookingSubmit);
}

async function handleBookingSubmit(e) {
    e.preventDefault();
    clearFormErrors();

    const name    = document.getElementById('name').value.trim();
    const phone   = document.getElementById('phone').value.trim();
    const email   = document.getElementById('email')?.value.trim()   || '';
    const model   = document.getElementById('model')?.value.trim()   || '';
    const year    = document.getElementById('year')?.value.trim()    || '';
    const message = document.getElementById('message')?.value.trim() || '';

    let hasError = false;
    if (!name)                         { showFieldError('name',               'Le nom complet est obligatoire');           hasError = true; }
    if (!phone)                        { showFieldError('phone',              'Le numéro de téléphone est obligatoire');   hasError = true; }
    if (!email)                        { showFieldError('email',              "L'email est obligatoire");                  hasError = true; }
    if (!model)                        { showFieldError('model',              'Le modèle du véhicule est obligatoire');    hasError = true; }
    if (!year)                         { showFieldError('year',               "L'année du véhicule est obligatoire");      hasError = true; }
    if (selectedServicesData.length === 0) { showFieldError('select-services-btn', 'Veuillez sélectionner au moins un service'); hasError = true; }

    if (hasError) {
        const firstError = document.querySelector('.field-error');
        if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    const totalBase          = selectedServicesData.reduce((sum, s) => sum + (s.price || 0), 0);
    const discountInfo       = await checkReturningCustomer(phone);
    const discountPercent    = Math.max(0, Math.min(20, Number(discountInfo?.discountPercent) || 0));
    const finalPrice         = discountPercent > 0 ? Math.round(totalBase * (1 - discountPercent / 100)) : totalBase;

    currentBookingData = {
        name, phone, email, model, year, message,
        services: selectedServicesData,
        totalBase,
        discountPercent,
        finalPrice
    };
    showPriceConfirmation();
}

function showFieldError(fieldId, errorMessage) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    field.classList.add('field-error');
    const errorDiv = document.createElement('div');
    errorDiv.className   = 'error-message';
    errorDiv.textContent = errorMessage;
    field.parentNode.insertBefore(errorDiv, field.nextSibling);
    field.addEventListener('focus', function () {
        this.classList.remove('field-error');
        const nextEl = this.nextElementSibling;
        if (nextEl && nextEl.classList.contains('error-message')) nextEl.remove();
    }, { once: true });
}

function clearFormErrors() {
    document.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));
    document.querySelectorAll('.error-message').forEach(el => el.remove());
}

async function checkReturningCustomer(phone) {
    try {
        const res    = await fetch(API_URL + '/reservations/check-customer/' + encodeURIComponent(phone));
        const result = await res.json();
        return result || {};
    } catch {
        return {};
    }
}

function showPriceConfirmation() {
    const data         = currentBookingData;
    const priceDetails = document.getElementById('price-details');
    const priceModal   = document.getElementById('price-modal');
    if (!priceDetails || !priceModal) { alert('Erreur: Modal de prix introuvable'); return; }

    const servicesHTML = data.services
        .map(s => `<div class="service-item"><span class="service-name">${s.name}</span></div>`)
        .join('');

    const discountBadge = (Number(data.discountPercent) || 0) > 0
        ? `<div class="discount-badge">Remise automatique : -${Number(data.discountPercent).toFixed(0)}%</div>`
        : '';

    priceDetails.innerHTML = `
        ${discountBadge}
        <div class="vehicle-info" style="background:#f8f9fa;padding:1rem;border-radius:6px;margin-bottom:1.5rem;">
            <strong style="color:#2c3e50;">Véhicule :</strong>
            <span style="color:#2c3e50;font-weight:600;">${data.model} (${data.year})</span>
        </div>
        <h4 style="margin:1.5rem 0 1rem 0;color:#2c3e50;">Services Sélectionnés</h4>
        <div class="services-list">${servicesHTML}</div>
        <div class="modal-actions">
            <button type="button" onclick="closeModal('price-modal')" class="btn btn-cancel">Annuler</button>
            <button type="button" onclick="confirmBooking()" class="btn btn-confirm">Confirmer la Réservation</button>
        </div>
    `;
    setModalVisible('price-modal', true);
}

async function confirmBooking() {
    try {
        const data = currentBookingData;
        if (!data) { alert('Erreur: Données manquantes'); return; }

        const formData = new FormData();
        formData.append('name',     data.name);
        formData.append('phone',    data.phone);
        formData.append('email',    data.email);
        formData.append('model',    data.model);
        formData.append('year',     data.year);
        formData.append('message',  data.message);
        formData.append('services', JSON.stringify(data.services));
        formData.append('basePrice',  String(Math.round(Number(data.totalBase) || 0)));
        formData.append(
            'discount',
            String(Math.max(0, Math.round(Number(data.totalBase) || 0) - Math.round(Number(data.finalPrice) || 0)))
        );
        formData.append('finalPrice', String(Math.round(Number(data.finalPrice) || 0)));

        const response = await fetch(API_URL + '/reservations', { method: 'POST', body: formData });
        const result   = await response.json();

        if (result.success) {
            closeModal('price-modal');
            const successModal = document.getElementById('success-modal');
            if (successModal) setModalVisible('success-modal', true);
            else alert('✅ Réservation confirmée avec succès !');
            document.getElementById('booking-form').reset();
            selectedServicesData = [];
            updateSelectedServicesDisplay();
        } else {
            alert('❌ ' + result.message);
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert("❌ Erreur lors de l'envoi.");
    }
}
window.confirmBooking = confirmBooking;

// ============================================
// ANIMATIONS
// ============================================
function initAnimations() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity   = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.service-card, .gallery-item').forEach(el => {
        el.style.opacity    = '0';
        el.style.transform  = 'translateY(30px)';
        el.style.transition = 'all 0.6s ease-out';
        observer.observe(el);
    });
}

function initScrollIndicator() {
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;top:0;left:0;width:0%;height:3px;background:linear-gradient(90deg,var(--primary-color),var(--secondary-color));z-index:9999;';
    document.body.appendChild(bar);
    window.addEventListener('scroll', () => {
        bar.style.width = (window.scrollY / (document.body.scrollHeight - window.innerHeight) * 100) + '%';
    });
}

// ============================================
// CHAT SYSTEM - Socket.io
// ============================================
function initChatSystem() {
    if (typeof io === 'undefined') { console.warn('⚠️ Socket.io non chargé'); return; }

    socket = (typeof window !== 'undefined' && String(window.location.port) === '5000')
        ? io()
        : io(API_ORIGIN);

    socket.on('connect', () => {
        console.log('⚡ Socket connecté');
        if (currentClient) {
            socket.emit('register', currentClient.id, 'client');
            loadOrCreateConversation();
        }
    });

    socket.on('receive_message', (data) => {
        const convId = data.conversation_id || data.conversationId;
        if (convId === currentConversationId && data.sender_type !== 'client') {
            displayMessage(data);
            // ✅ Le client ne marque PAS delivered/read lui-même
            // C'est l'admin qui appelle markDelivered('admin') côté admin.js
            // → le backend émet messages_status_updated → le client reçoit et met à jour le DOM
        }
    });

    socket.on('messages_status_updated', (data) => {
        if (Number(data?.conversationId) !== Number(currentConversationId)) return;
        updateMessageStatusesInDom(data.messageIds, data.status);
    });

    socket.on('message_deleted', (data) => {
        if (Number(data?.conversationId) !== Number(currentConversationId)) return;
        const el = document.querySelector(`[data-message-id="${data.messageId}"]`);
        if (el) el.remove();
    });
}

/** Retourne true si le widget chat est ouvert, visible et l'onglet actif. */
function isClientChatReallyOpen() {
    const widget   = document.getElementById('chatWidget');
    const convArea = document.getElementById('chatConversationArea');
    const open     = !!widget   && widget.style.display === 'flex';
    const hasArea  = !!convArea && convArea.style.display !== 'none';
    const tabVisible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
    return open && hasArea && tabVisible;
}

// ============================================
// AUTHENTIFICATION CLIENT
// ============================================
function checkClientAuth() {
    const data = localStorage.getItem('clientUser');
    if (data) {
        currentClient = JSON.parse(data);
        updateChatUI(true);
        if (socket?.connected) {
            socket.emit('register', currentClient.id, 'client');
            loadOrCreateConversation();
        }
    } else {
        updateChatUI(false);
    }
}

function updateChatUI(isLoggedIn) {
    const loginPrompt = document.getElementById('chatLoginPrompt');
    const convArea    = document.getElementById('chatConversationArea');
    const logoutBtn   = document.querySelector('.chat-logout-btn-header');
    if (loginPrompt) loginPrompt.style.display = isLoggedIn ? 'none'  : 'block';
    if (convArea)    convArea.style.display    = isLoggedIn ? 'flex'  : 'none';
    if (logoutBtn)   logoutBtn.style.display   = isLoggedIn ? 'inline-flex' : 'none';
}

window.logoutClient = function () {
    localStorage.removeItem('clientUser');
    localStorage.removeItem('clientToken');
    currentClient = null;
    currentConversationId = null;
    const list = document.getElementById('chatMessagesList');
    if (list) list.innerHTML = '';
    updateChatUI(false);
};

window.toggleChatWidget = function (event) {
    if (event) event.stopPropagation();
    const widget   = document.getElementById('chatWidget');
    const floatBtn = document.getElementById('chat-widget-btn');
    if (!widget) return;

    const isHidden = widget.style.display === 'none' || !widget.style.display;
    widget.style.display = isHidden ? 'flex' : 'none';
    if (floatBtn) floatBtn.style.display = isHidden ? 'none' : 'flex';

    if (isHidden) {
        // ✅ Marque "Vu" quand le widget s'ouvre
        if (currentClient && currentConversationId) {
            syncConversationStatuses('client', true);
        }
        // ✅ Scroll vers le bas à l'ouverture
        const container = document.getElementById('chatMessagesList');
        if (container) {
            requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
        }
    }
};

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isClientChatReallyOpen() && currentClient && currentConversationId) {
        syncConversationStatuses('client', true);
    }
});

window.showClientAuthModal = function (type) {
    const loginForm  = document.getElementById('clientLoginForm');
    const signupForm = document.getElementById('clientSignupForm');
    const title      = document.getElementById('authModalTitle');
    if (type === 'login') {
        title.textContent        = 'Connexion';
        loginForm.style.display  = 'block';
        signupForm.style.display = 'none';
    } else {
        title.textContent        = 'Inscription';
        loginForm.style.display  = 'none';
        signupForm.style.display = 'block';
    }
    setModalVisible('clientAuthModal', true);
};

window.handleClientLogin = async function () {
    const phone = document.getElementById('login-client-phone').value.trim();
    const pass  = document.getElementById('login-client-password').value;
    if (!phone || !pass) { alert('❌ Tous les champs sont requis'); return; }
    try {
        const res  = await fetch(API_URL + '/client/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telephone: phone, password: pass })
        });
        const data = await res.json();
        if (data.success) {
            localStorage.setItem('clientUser',  JSON.stringify(data.user));
            localStorage.setItem('clientToken', data.token);
            currentClient = data.user;
            closeModal('clientAuthModal');
            checkClientAuth();
            alert('✅ Connexion réussie !');
        } else {
            alert('❌ ' + data.message);
        }
    } catch (err) { console.error('Erreur:', err); alert('❌ Erreur serveur'); }
};

window.handleClientSignup = async function () {
    const name  = document.getElementById('signup-client-name').value.trim();
    const phone = document.getElementById('signup-client-phone').value.trim();
    const pass  = document.getElementById('signup-client-password').value;
    if (!name || !phone || !pass) { alert('❌ Tous les champs sont obligatoires'); return; }
    try {
        const res  = await fetch(API_URL + '/client/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nom: name, telephone: phone, password: pass })
        });
        const data = await res.json();
        if (data.success) { alert('✅ Inscription réussie ! Connectez-vous.'); showClientAuthModal('login'); }
        else { alert('❌ ' + data.message); }
    } catch (err) { console.error('Erreur:', err); alert('❌ Erreur serveur'); }
};

// ============================================
// CONVERSATION
// ============================================
async function loadOrCreateConversation() {
    if (!currentClient) return;
    try {
        const res  = await fetch(API_URL + '/chat/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: currentClient.id })
        });
        const data = await res.json();
        if (data.success) {
            currentConversationId = data.conversation.id;
            socket.emit('join_conversation', currentConversationId);
            loadMessages();
            // ✅ On ne marque plus delivered côté client
            // C'est l'admin qui déclenche la mise à jour via markDelivered('admin')
        }
    } catch (err) { console.error('Erreur conversation:', err); }
}

/** Charge les messages puis scrolle vers le dernier. */
async function loadMessages() {
    const container = document.getElementById('chatMessagesList');
    if (!container) return;
    container.innerHTML = '';
    try {
        const res  = await fetch(API_URL + '/chat/messages/' + currentConversationId);
        const data = await res.json();
        if (data.success) {
            data.data.forEach(msg => displayMessage(msg));
            // ✅ Juste scroll — les statuts viennent du socket ou de l'état initial en DB
            requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
        }
    } catch (err) { console.error('Erreur messages:', err); }
}

/**
 * Affiche un message dans la liste.
 * - Le span de statut (Envoyé / Reçu / Vu) n'apparaît que sur les messages du CLIENT
 *   (comportement identique à WhatsApp : les coches sont sur vos propres messages).
 * - Scroll intelligent : descend uniquement si l'utilisateur était déjà en bas (< 150 px).
 */
function displayMessage(msg) {
    const container = document.getElementById('chatMessagesList');
    if (!container) return;

    // Déterminer si l'utilisateur est déjà en bas avant insertion
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;

    const row = document.createElement('div');
    row.className      = 'chat-message ' + (msg.sender_type === 'client' ? 'msg-me' : 'msg-other');
    row.dataset.messageId = msg.id;

    if (msg.sender_type === 'client') {
        row.addEventListener('contextmenu', (e) => { e.preventDefault(); showMessageContextMenu(e, msg.id); });
    }

    // --- Contenu du message ---
    const contentWrap = document.createElement('div');
    contentWrap.className = 'msg-content';

    if (msg.message_type === 'image' && msg.file_path) {
        const u = mediaFileUrl(msg.file_path);
        contentWrap.innerHTML = `<img src="${u}" style="max-width:100%;border-radius:12px;cursor:pointer" onclick="window.open('${u}','_blank')">`;
    } else if (msg.message_type === 'audio' && msg.file_path) {
        const au = mediaFileUrl(msg.file_path);
        contentWrap.innerHTML = `
            <div class="audio-message">
                <button class="audio-play-btn" onclick="playAudio(this,'${au}')">▶</button>
                <div class="audio-waveform">
                    <div class="wave-bar"></div><div class="wave-bar"></div>
                    <div class="wave-bar"></div><div class="wave-bar"></div>
                    <div class="wave-bar"></div>
                </div>
                <span class="audio-duration">0:00</span>
            </div>`;
        row.classList.add('audio-bubble');
    } else if (msg.message_type === 'video' && msg.file_path) {
        const vu = mediaFileUrl(msg.file_path);
        contentWrap.innerHTML = `<video controls style="max-width:100%;border-radius:12px"><source src="${vu}" type="video/mp4"></video>`;
    } else {
        const bubble = document.createElement('div');
        bubble.textContent = msg.message_text || '';
        contentWrap.appendChild(bubble);
    }

    row.appendChild(contentWrap);

    // --- Métadonnées (heure + statut) ---
    const meta      = document.createElement('div');
    meta.className  = 'msg-meta';
    const createdAt = msg.created_at ? new Date(msg.created_at) : new Date();
    const timeSpan  = document.createElement('span');
    timeSpan.textContent = createdAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    meta.appendChild(timeSpan);

    // ✅ Statut uniquement sur les messages du CLIENT
    // Même logique que admin.js : setAttribute explicite + classe msg-status posée par applyMessageStatusChip
    if (msg.sender_type === 'client') {
        const statusSpan = document.createElement('span');
        statusSpan.setAttribute('data-message-id', String(msg.id));
        applyMessageStatusChip(statusSpan, msg.status || 'sent');
        meta.appendChild(statusSpan);
    }

    row.appendChild(meta);
    container.appendChild(row);

    // ✅ Scroll intelligent
    if (isAtBottom) {
        requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
    }
}

window.playAudio = function (btn, url) {
    const audio       = new Audio(url);
    const waveform    = btn.nextElementSibling;
    const durationSpan = waveform.nextElementSibling;

    audio.play(); btn.textContent = '⏸'; waveform.classList.add('playing');
    audio.ontimeupdate = () => {
        const m = Math.floor(audio.currentTime / 60);
        const s = Math.floor(audio.currentTime % 60);
        durationSpan.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    };
    audio.onended = () => { btn.textContent = '▶'; waveform.classList.remove('playing'); };
    btn.onclick = () => {
        if (audio.paused) { audio.play(); btn.textContent = '⏸'; waveform.classList.add('playing'); }
        else              { audio.pause(); btn.textContent = '▶'; waveform.classList.remove('playing'); }
    };
};

// ============================================
// ENVOI MESSAGES
// ============================================
window.sendChatText = function (event) {
    if (event) event.preventDefault();
    const input = document.getElementById('chatMessageInput');
    const text  = input.value.trim();
    if (!text) return;

    if (!currentConversationId || currentConversationId === null || currentConversationId === 'null') {
        loadOrCreateConversation().then(() => { setTimeout(() => sendChatText(event), 500); });
        return;
    }

    fetch(API_URL + '/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: currentConversationId, senderType: 'client', text })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            displayMessage(data.message);
            socket.emit('send_message', { ...data.message, conversation_id: currentConversationId, conversationId: currentConversationId });
        }
    })
    .catch(err => console.error('Erreur:', err));

    input.value = '';
};

window.handleChatKeyPress = function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatText(e); }
};

window.sendChatImage = function (input) {
    const file = input.files[0];
    if (!file) return;
    if (!currentConversationId || currentConversationId === null || currentConversationId === 'null') {
        alert('❌ Reconnectez-vous pour envoyer des images.');
        return;
    }
    const formData = new FormData();
    formData.append('conversationId', currentConversationId);
    formData.append('senderType', 'client');
    formData.append('file', file);
    fetch(API_URL + '/chat/messages', { method: 'POST', body: formData })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                displayMessage(data.message);
                socket.emit('send_message', { ...data.message, conversation_id: currentConversationId, conversationId: currentConversationId });
            }
        })
        .catch(err => console.error('Erreur:', err));
    input.value = '';
};

// ============================================
// AUDIO - APPUI LONG
// ============================================
const recordBtn = document.getElementById('recordAudioBtn');
if (recordBtn) {
    let pressTimer;
    recordBtn.addEventListener('mousedown',  ()  => { pressTimer = setTimeout(() => startRecording(), 200); });
    recordBtn.addEventListener('mouseup',    ()  => { clearTimeout(pressTimer); if (isRecording) stopRecording(); });
    recordBtn.addEventListener('touchstart', (e) => { e.preventDefault(); pressTimer = setTimeout(() => startRecording(), 200); });
    recordBtn.addEventListener('touchend',   (e) => { e.preventDefault(); clearTimeout(pressTimer); if (isRecording) stopRecording(); });
}

function startRecording() {
    if (isRecording) return;
    if (!currentConversationId || currentConversationId === null || currentConversationId === 'null') {
        alert("❌ Connectez-vous d'abord pour envoyer des vocaux");
        return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            isRecording        = true;
            recordingStartTime = Date.now();
            mediaRecorder      = new MediaRecorder(stream);
            audioChunks        = [];
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.start();
            const btn = document.getElementById('recordAudioBtn');
            if (btn) { btn.textContent = '⏹️'; btn.style.color = '#e74c3c'; btn.style.transform = 'scale(1.2)'; }
        })
        .catch(() => { alert('❌ Accès microphone refusé'); isRecording = false; });
}

function stopRecording() {
    if (!isRecording || !mediaRecorder || mediaRecorder.state === 'inactive') return;
    isRecording = false;
    mediaRecorder.stop();
    const btn = document.getElementById('recordAudioBtn');
    if (btn) { btn.textContent = '🎤'; btn.style.color = ''; btn.style.transform = ''; }

    mediaRecorder.onstop = () => {
        if (!currentConversationId || currentConversationId === null || currentConversationId === 'null') {
            mediaRecorder.stream.getTracks().forEach(t => t.stop());
            return;
        }
        const blob = new Blob(audioChunks, { type: 'audio/webm; codecs=opus' });
        const file = new File([blob], `vocal-${Date.now()}.webm`, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('conversationId', currentConversationId);
        formData.append('senderType', 'client');
        formData.append('file', file);
        fetch(API_URL + '/chat/messages', { method: 'POST', body: formData })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    displayMessage(data.message);
                    socket.emit('send_message', { ...data.message, conversation_id: currentConversationId, conversationId: currentConversationId });
                }
            })
            .catch(err => console.error('Erreur:', err));
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
    };
}

// ============================================
// MENU CONTEXTUEL - SUPPRIMER MESSAGE
// ============================================
function showMessageContextMenu(event, messageId) {
    const existingMenu = document.getElementById('message-context-menu');
    if (existingMenu) existingMenu.remove();
    const menu = document.createElement('div');
    menu.id        = 'message-context-menu';
    menu.className = 'message-context-menu';
    menu.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;`;
    menu.innerHTML = `<button onclick="deleteMessage(${messageId})" class="delete">🗑️ Supprimer</button>`;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', closeContextMenu), 10);
}

function closeContextMenu() {
    const menu = document.getElementById('message-context-menu');
    if (menu) menu.remove();
    document.removeEventListener('click', closeContextMenu);
}

async function deleteMessage(messageId) {
    if (!confirm('Supprimer ce message ?')) { closeContextMenu(); return; }
    try {
        const response = await fetch(`${API_URL}/chat/messages/${messageId}`, { method: 'DELETE' });
        const result   = await response.json();
        if (result.success) {
            const el = document.querySelector(`[data-message-id="${messageId}"]`);
            if (el) { el.style.transition = 'all 0.3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }
            if (socket?.connected) socket.emit('delete_message', { messageId, conversationId: currentConversationId });
        }
    } catch (error) { console.error('Erreur:', error); }
    closeContextMenu();
}
window.deleteMessage = deleteMessage;

console.log('✅ RY Performance - Script chargé!');