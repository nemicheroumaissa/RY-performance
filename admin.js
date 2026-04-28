// ============================================
// ADMIN.JS - VERSION COMPLÈTE FINALE
// Login OK + Stats + Badge + Chat fonctionnel
// ============================================

ffunction resolveApiOrigin() {
    if (typeof window !== 'undefined' && window.API_BASE) {
        return String(window.API_BASE).replace(/\/+$/, '');
    }
    return 'https://ry-performance.onrender.com';
}

const API_ORIGIN = resolveApiOrigin();
const API_URL = `${API_ORIGIN}/api`;

let isLoggedIn = false;
let currentUser = null;
let authToken = null;
let currentDeleteId = null;
let allOrders = [];

let adminSocket = null;
let adminConversations = [];
let currentAdminConversationId = null;
let currentAdminClientName = '';
let currentPriceHasRemise = false;
let currentPriceServices = [];

// ✅ NOUVELLES VARIABLES POUR AUDIO
let adminMediaRecorder = null;
let adminAudioChunks = [];
let isAdminRecording = false;
let adminRecordingStartTime = 0;

// [MOD 4] Variable pour la recherche de conversations
let adminConvSearchQuery = '';

function scrollAdminChatToBottom() {
    const container = document.getElementById('adminChatMessages');
    if (!container) return;
    const apply = () => {
        container.scrollTop = container.scrollHeight;
    };
    requestAnimationFrame(() => requestAnimationFrame(apply));
    setTimeout(apply, 80);
}

// [MOD 5] setAdminMessageStatusSpan — gris foncé pour sent/delivered, mauve pour read
function setAdminMessageStatusSpan(span, status) {
    const s = status || 'sent';
    if (s === 'read') {
        span.textContent = 'Vu';
        span.className = 'msg-status msg-status-read';
    } else if (s === 'delivered') {
        span.textContent = 'Reçu';
        span.className = 'msg-status msg-status-delivered';
    } else {
        span.textContent = 'Env.';
        span.className = 'msg-status msg-status-sent';
    }
}

// [MOD 1] closeAdminMessageContextMenu — identique à l'original
function closeAdminMessageContextMenu() {
    const menu = document.getElementById('admin-message-context-menu');
    if (menu) menu.remove();
    document.removeEventListener('click', closeAdminMessageContextMenu);
}

// [MOD 1] showAdminMessageContextMenu — identique à l'original (déjà clic droit)
function showAdminMessageContextMenu(event, messageId) {
    closeAdminMessageContextMenu();
    const menu = document.createElement('div');
    menu.id = 'admin-message-context-menu';
    menu.className = 'message-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 220)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 80)}px`;
    menu.style.zIndex = '10050';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'delete message-context-action';
    btn.textContent = 'Supprimer ce message';
    btn.addEventListener('click', () => {
        deleteAdminMessage(messageId);
    });
    menu.appendChild(btn);
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', closeAdminMessageContextMenu), 10);
}

async function refreshAdminMessageStatuses() {
    if (!currentAdminConversationId) return;
    try {
        const res = await fetch(`${API_URL}/chat/messages/${currentAdminConversationId}`);
        const result = await res.json();
        if (!result.success) return;
        const map = {};
        (result.data || []).forEach((m) => { map[m.id] = m; });
        document.querySelectorAll('#adminChatMessages .admin-chat-row.me .msg-status').forEach((span) => {
            const id = span.dataset.messageId;
            if (id && map[id]) setAdminMessageStatusSpan(span, map[id].status);
        });
        scrollAdminChatToBottom();
    } catch (e) {
        console.error(e);
    }
}

/** Badge « client fidèle » / filtre : basé uniquement sur la BDD, pas sur remise > 0 */
function isReservationClientFidele(row) {
    const v = row && row.est_client_fidele;
    return v === 1 || v === true || v === '1';
}

function applyLoyaltyByPhone(orders) {
    const byPhone = new Map();
    for (const o of orders) {
        const phone = String(o.phone || '').trim();
        if (!phone) continue;
        if (!byPhone.has(phone)) byPhone.set(phone, []);
        byPhone.get(phone).push(o);
    }
    for (const [, list] of byPhone.entries()) {
        list.sort((a, b) => (a.dateRaw || 0) - (b.dateRaw || 0));
        list.forEach((o, idx) => {
            o.isFidele = idx >= 1;
            o.discountApplied = o.isFidele;
        });
    }
    return orders;
}

const serviceNames = {
    'peinture': 'Peinture Automobile',
    'vinyl': 'Covering Vinyl Complet',
    'bodykit': 'Kit Carrosserie',
    'rims': 'Jantes Customization',
    'tint': 'Vitres Teintées',
    'lights': 'Phares/Feux Teintés',
    'decals': 'Stickers & Graphics',
    'ceramic': 'Coating Céramique',
    'ppf': 'PPF Pare-chocs'
};

// ============================================
// INITIALISATION
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    console.log('🔧 Admin Panel - Initialisation...');
    checkAuth();
    initializeEventListeners();
    initAdminAudioRecording(); // ✅ NOUVEAU
});

function initializeEventListeners() {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);

    const confirmDeleteBtn = document.getElementById('confirmDelete');
    if (confirmDeleteBtn) confirmDeleteBtn.addEventListener('click', handleDelete);

    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
        }
    });
}

function switchAuthTab(tab) {
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    document.querySelectorAll('.auth-tab').forEach(btn => btn.classList.remove('active'));
    if (tab === 'login') {
        document.querySelector('.auth-tab:first-child').classList.add('active');
        loginForm.classList.add('active');
        signupForm.classList.remove('active');
    } else {
        document.querySelector('.auth-tab:last-child').classList.add('active');
        loginForm.classList.remove('active');
        signupForm.classList.add('active');
    }
    document.getElementById('loginError').innerHTML = '';
}

// ============================================
// AUTHENTIFICATION
// ============================================
async function checkAuth() {
    authToken = localStorage.getItem('authToken');
    if (!authToken) { showLogin(); return false; }
    try {
        const response = await fetch(`${API_URL}/auth/verify`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const result = await response.json();
        if (!result.success) { localStorage.clear(); showLogin(); return false; }
        currentUser = result.user;
        isLoggedIn = true;
        showDashboard();
        return true;
    } catch (error) {
        localStorage.clear();
        showLogin();
        return false;
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    if (!username || !password) {
        showMessage('Veuillez remplir tous les champs', 'error', 'loginError');
        return;
    }
    try {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const result = await response.json();
        if (result.success) {
            localStorage.setItem('authToken', result.token);
            localStorage.setItem('user', JSON.stringify(result.user));
            authToken = result.token;
            currentUser = result.user;
            isLoggedIn = true;
            showMessage('✅ Connexion réussie !', 'success', 'loginError');
            setTimeout(() => showDashboard(), 500);
        } else {
            showMessage('❌ ' + result.message, 'error', 'loginError');
        }
    } catch (error) {
        console.error('Login:', error);
        showMessage(
            '❌ Impossible de joindre l\'API (port 5000). Ouvrez admin.html via le même hôte que le serveur (ex. http://127.0.0.1:5500 et API sur http://127.0.0.1:5000), ou avant admin.js : window.API_BASE = "http://IP:5000";',
            'error',
            'loginError'
        );
    }
}

async function handleSignup() {
    const nom_complet = document.getElementById('signup-nom').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const telephone = document.getElementById('signup-telephone').value.trim();
    const username = document.getElementById('signup-username').value.trim();
    const password = document.getElementById('signup-password').value;
    const message_demande = document.getElementById('signup-message').value.trim();
    if (!nom_complet || !email || !username || !password) {
        showMessage('❌ Champs obligatoires manquants', 'error', 'loginError');
        return;
    }
    try {
        const response = await fetch(`${API_URL}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nom_complet, email, telephone, username, password, message_demande })
        });
        const result = await response.json();
        if (result.success) {
            document.getElementById('signup-nom').value = '';
            document.getElementById('signup-email').value = '';
            document.getElementById('signup-telephone').value = '';
            document.getElementById('signup-username').value = '';
            document.getElementById('signup-password').value = '';
            document.getElementById('signup-message').value = '';
            showMessage('Votre demande a été envoyée', 'success', 'loginError');
            setTimeout(() => switchAuthTab('login'), 3000);
        } else {
            showMessage('❌ ' + result.message, 'error', 'loginError');
        }
    } catch (error) {
        showMessage('❌ Erreur serveur', 'error', 'loginError');
    }
}

function logout() {
    localStorage.clear();
    authToken = null; currentUser = null; isLoggedIn = false;
    showLogin();
}

function showLogin() {
    document.getElementById('loginSection').style.display = 'flex';
    document.getElementById('dashboardSection').classList.remove('active');
}

function showDashboard() {
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('dashboardSection').classList.add('active');
    document.getElementById('userName').textContent = `👨‍💼 ${currentUser.nom_complet}`;
    const demandesTab = document.getElementById('demandesTab');
    const messagesTab = document.getElementById('messagesTab');
    if (currentUser.role === 'admin') {
        demandesTab.style.display = 'block';
        loadPendingRequests();
    } else {
        demandesTab.style.display = 'none';
    }
    messagesTab.style.display = 'block';
    initAdminMessaging();
    loadOrders();
    updateStatistics();
    
    // ✅ Rafraîchir stats automatiquement
    setInterval(() => {
        updateStatistics();
        updatePendingBadge();
    }, 30000);
}

function switchAdminTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.admin-tab-panel').forEach(panel => panel.classList.remove('active'));
    if (tab === 'reservations') {
        document.querySelector('.tab-btn:first-child').classList.add('active');
        document.getElementById('reservationsTabContent').classList.add('active');
    } else if (tab === 'demandes') {
        document.querySelector('#demandesTab').classList.add('active');
        document.getElementById('demandesTabContent').classList.add('active');
        loadPendingRequests();
    } else if (tab === 'messages') {
        document.querySelector('#messagesTab').classList.add('active');
        document.getElementById('messagesTabContent').classList.add('active');
        loadAdminConversations();
    }
}

// ============================================
// ✅ BADGE NOTIFICATIONS
// ============================================
async function updatePendingBadge() {
    try {
        const response = await fetch(`${API_URL}/reservations`);
        const result = await response.json();
        
        if (result.success) {
            const reservations = result.data;
            const nonTraitees = reservations.filter(r => 
                r.statut === 'Nouveau' || r.statut === 'En cours'
            ).length;
            
            const badge = document.getElementById('pendingBadge');
            if (badge) {
                if (nonTraitees > 0) {
                    badge.textContent = nonTraitees;
                    badge.style.display = 'inline-block';
                } else {
                    badge.style.display = 'none';
                }
            }
        }
    } catch (error) {
        console.error('❌ Erreur badge:', error);
    }
}

// ============================================
// RÉSERVATIONS
// ============================================
async function loadOrders() {
    try {
        const response = await fetch(`${API_URL}/reservations`);
        const result = await response.json();

        if (result.success) {
            allOrders = result.data.map(order => ({
                id:             order.id,
                orderId:        String(order.id || order.order_id || ''),
                name:           order.client_nom      || order.nom           || '',
                phone:          order.client_telephone || order.telephone     || '',
                email:          order.client_email     || order.email         || '',
                model:          order.modele_vehicule  || '',
                year:           order.annee_vehicule   || '',
                services:       (() => {
                    const raw = order.services_liste_agg || order.services_noms || '';
                    return raw ? String(raw).split(',').map(s => s.trim()).filter(Boolean) : [];
                })(),
                basePrice:      parseFloat(order.prix_base)  || 0,
                discount:       parseFloat(order.remise)     || 0,
                finalPrice:     parseFloat(order.prix_final) || 0,
                delaiRemise:    order.delai_remise != null ? String(order.delai_remise) : '',
                // Par défaut: basé sur la BDD (si la vue fournit la donnée)
                isFidele:       isReservationClientFidele(order),
                discountApplied: isReservationClientFidele(order),
                message:        order.message_client   || '',
                status:         order.statut           || 'Nouveau',
                dateRaw:        order.date_reservation ? new Date(order.date_reservation).getTime() : 0,
                date:           order.date_reservation ? new Date(order.date_reservation).toLocaleString('fr-FR') : '',
                images:         order.nombre_images    || 0
            }));
            
            applyLoyaltyByPhone(allOrders);

            console.log(`✅ ${allOrders.length} réservations chargées`);
            renderOrdersTable(allOrders);
            updatePendingBadge();
        }
    } catch (error) {
        console.error('❌ Erreur loadOrders:', error);
    }
}

function renderOrdersTable(orders) {
    const tbody = document.getElementById('ordersTableBody');
    const emptyState = document.getElementById('emptyState');

    if (!tbody) return;

    if (orders.length === 0) {
        tbody.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    // ✅ TRI
    const sorted = [...orders].sort((a, b) => {
        const priority = {
            'Nouveau': 1,
            'En cours': 2,
            'Terminé': 3,
            'Annulé': 4
        };
        const pa = priority[a.status] || 5;
        const pb = priority[b.status] || 5;
        if (pa !== pb) return pa - pb;
        return (b.dateRaw || 0) - (a.dateRaw || 0);
    });

    tbody.innerHTML = sorted.map(order => {
        const rowClass = (order.status === 'Terminé' || order.status === 'Annulé')
            ? 'style="background: rgba(255,255,255,0.06);"'
            : '';

        const statusClass = {
            'Nouveau': 'status-new',
            'En cours': 'status-progress',
            'Terminé': 'status-done',
            'Annulé': 'status-cancelled'
        }[order.status] || 'status-new';

        const servicesHtml = order.services.length > 0
            ? order.services.map(s => `<span class="service-badge">${escapeHtml(s)}</span>`).join('')
            : '<span style="color:var(--silver)">—</span>';

        const hasFideliteRemise = !!order.isFidele;
        const hasBasePrice = (order.basePrice || 0) > 0;
        const hasFinalPrice = (order.finalPrice || 0) > 0;
        const hasRemiseMontant = hasBasePrice && hasFinalPrice && (order.basePrice > order.finalPrice);
        const delaiTxt = (order.delaiRemise && String(order.delaiRemise).trim()) ? String(order.delaiRemise).trim() : '';
        const showRemiseCadre = hasRemiseMontant || !!delaiTxt;

        let priceHtml = `<div style="font-weight:bold;color:var(--silver)">Prix à définir</div>`;
        if (hasFinalPrice) {
            if (showRemiseCadre) {
                const remiseMontant = hasRemiseMontant ? (order.basePrice - order.finalPrice) : 0;
                const remiseBloc = hasRemiseMontant
                    ? `<div style="margin-bottom:0.5rem;"><strong>Remise</strong> : ${formatPrice(remiseMontant)}<br><span style="font-size:0.78rem;color:var(--silver)">Prix avant remise : ${formatPrice(order.basePrice)}</span></div>`
                    : '';
                const delaiBloc = delaiTxt
                    ? `<div style="margin-bottom:0.5rem;font-size:0.85rem;"><strong>Délai de la remise</strong> : ${escapeHtml(delaiTxt)}</div>`
                    : '';
                priceHtml = `
                    <div class="admin-price-remise-frame">
                        ${remiseBloc}
                        ${delaiBloc}
                        <div style="color:var(--primary-color);font-weight:bold;font-size:1.05rem;">Prix final : ${formatPrice(order.finalPrice)}</div>
                    </div>`;
            } else {
                priceHtml = `<div style="color:var(--primary-color);font-weight:bold">${formatPrice(order.finalPrice)}</div>`;
            }
        }

        const remiseIndicatorHtml = (hasFideliteRemise && !hasFinalPrice)
            ? `<div style="margin-top:4px;font-size:0.78rem;color:var(--success);font-weight:600">Remise: oui</div>`
            : '';

        // [MOD 7] Boutons en icônes compactes pour éviter la coupure dans le tableau
        return `
        <tr ${rowClass}>
            <td><span style="font-family:monospace;font-size:0.85rem">${order.orderId}</span></td>
            <td>
                <div style="font-weight:600">${order.name}</div>
                ${order.isFidele ? '<span style="background:#2ecc71;color:#000;padding:2px 6px;border-radius:4px;font-size:0.75rem">CLIENT FIDÈLE</span>' : ''}
            </td>
            <td>
                <div>📞 ${order.phone}</div>
                ${order.email ? `<div style="font-size:0.85rem;color:var(--silver)">✉️ ${order.email}</div>` : ''}
            </td>
            <td>
                <div>${order.model || '—'}</div>
                ${order.year ? `<div style="color:var(--silver);font-size:0.85rem">${order.year}</div>` : ''}
            </td>
            <td>${servicesHtml}</td>
            <td>${priceHtml}${remiseIndicatorHtml}</td>
            <td style="max-width:150px;font-size:0.85rem">${order.message ? order.message.substring(0, 80) + (order.message.length > 80 ? '...' : '') : '—'}</td>
            <td>
                <span class="status-badge ${statusClass}">${order.status}</span>
                <div style="font-size:0.8rem;color:var(--silver);margin-top:4px">${order.date}</div>
            </td>
            <td>
                <div class="reservation-actions">
                    <div class="reservation-actions-top">
                        <button type="button" onclick="openReservationDetails(${order.id})" class="btn btn-secondary btn-small action-btn" title="Détails">📋</button>
                        <button onclick="openPriceModal(${order.id})" class="btn btn-secondary btn-small action-btn" title="Prix">💰</button>
                        <button onclick="openEditReservationModal(${order.id})" class="btn btn-secondary btn-small action-btn" title="Modifier">✏️</button>
                    </div>
                    <select onchange="updateStatus(${order.id}, this.value)" class="status-select action-select">
                        <option value="Nouveau"   ${order.status==='Nouveau'  ?'selected':''}>Nouveau</option>
                        <option value="En cours"  ${order.status==='En cours' ?'selected':''}>En cours</option>
                        <option value="Terminé"   ${order.status==='Terminé'  ?'selected':''}>Terminé</option>
                        <option value="Annulé"    ${order.status==='Annulé'   ?'selected':''}>Annulé</option>
                    </select>
                    <button onclick="deleteOrder(${order.id})" class="btn btn-danger btn-small action-btn" title="Supprimer">🗑️</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function refreshOrders() {
    loadOrders();
    updateStatistics();
}

function filterOrders() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const status = document.getElementById('statusFilter').value;
    const discount = document.getElementById('discountFilter').value;

    const filtered = allOrders.filter(order => {
        const matchSearch = !search ||
            order.name.toLowerCase().includes(search) ||
            order.phone.includes(search) ||
            order.model.toLowerCase().includes(search) ||
            order.orderId.toLowerCase().includes(search);
        const matchStatus = !status || order.status === status;
        const matchDiscount = !discount ||
            (discount === 'true' && order.discountApplied) ||
            (discount === 'false' && !order.discountApplied);
        return matchSearch && matchStatus && matchDiscount;
    });

    renderOrdersTable(filtered);
}

async function updateStatus(id, newStatus) {
    try {
        const response = await fetch(`${API_URL}/reservations/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ statut: newStatus })
        });
        const result = await response.json();
        if (result.success) {
            const order = allOrders.find(o => o.id === id);
            if (order) order.status = newStatus;
            showMessage('✅ Statut mis à jour', 'success');
            loadOrders();
            updateStatistics();
        }
    } catch (error) {
        console.error('❌ Erreur updateStatus:', error);
    }
}

function deleteOrder(id) {
    currentDeleteId = id;
    document.getElementById('deleteModal').style.display = 'block';
}

async function handleDelete() {
    if (!currentDeleteId) return;
    try {
        const response = await fetch(`${API_URL}/reservations/${currentDeleteId}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.success) {
            allOrders = allOrders.filter(o => o.id !== currentDeleteId);
            renderOrdersTable(allOrders);
            closeModal('deleteModal');
            showMessage('✅ Réservation supprimée', 'success');
            updateStatistics();
        }
    } catch (error) {
        console.error('❌ Erreur delete:', error);
    }
    currentDeleteId = null;
}

// ============================================
// STATISTIQUES
// ============================================
async function updateStatistics() {
    try {
        const response = await fetch(`${API_URL}/reservations`);
        const result = await response.json();
        
        if (result.success) {
            const reservations = result.data;
            
            const total = reservations.length;
            const nonTraitees = reservations.filter(r => 
                r.statut === 'Nouveau' || r.statut === 'En cours'
            ).length;
            
            const phoneCounts = new Map();
            reservations.forEach(r => {
                const p = String(r.client_telephone || r.telephone || '').trim();
                if (!p) return;
                phoneCounts.set(p, (phoneCounts.get(p) || 0) + 1);
            });
            const fideles = Array.from(phoneCounts.values()).filter(c => c >= 2).length;
            const revenu = reservations.reduce((sum, r) => 
                sum + parseFloat(r.prix_final || 0), 0
            );
            const moyenne = total > 0 ? Math.round(revenu / total) : 0;
            
            const totalEl = document.getElementById('totalOrders');
            const pendingEl = document.getElementById('pendingOrders');
            const fideleEl = document.getElementById('returningCustomers');
            const revenuEl = document.getElementById('totalRevenue');
            const moyenneEl = document.getElementById('averageOrder');
            
            if (totalEl) totalEl.textContent = total;
            if (pendingEl) pendingEl.textContent = nonTraitees;
            if (fideleEl) fideleEl.textContent = fideles;
            if (revenuEl) revenuEl.textContent = formatPrice(revenu);
            if (moyenneEl) moyenneEl.textContent = formatPrice(moyenne);
        }
    } catch (error) {
        console.error('❌ Erreur stats:', error);
    }
}

function formatPrice(price) {
    const n = Math.round(Number(price) || 0);
    return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n) + ' DZD';
}

function showMessage(text, type, containerId = null) {
    document.querySelectorAll('.message').forEach(msg => msg.remove());
    const message = document.createElement('div');
    message.className = `message ${type}`;
    message.textContent = text;
    if (containerId) {
        const container = document.getElementById(containerId);
        if (container) container.appendChild(message);
    } else {
        const dashboard = document.querySelector('.commands-section');
        if (dashboard) dashboard.insertBefore(message, dashboard.firstChild);
    }
    setTimeout(() => message.remove(), 5000);
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
}

// ============================================
// PHOTOS RÉSERVATION (ADMIN)
// ============================================
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildImageSrc(cheminFichier, nomFichier) {
    let p = (cheminFichier || '').toString().replace(/\\/g, '/');
    p = p.replace(/^\/+/, '');

    const marker = 'uploads/';
    const idx = p.toLowerCase().lastIndexOf(marker);
    if (idx !== -1) {
        const tail = p.slice(idx + marker.length);
        return `${API_ORIGIN}/uploads/${tail}`;
    }

    if (p.startsWith('uploads/')) {
        return `${API_ORIGIN}/${p}`;
    }

    if (!p && nomFichier) {
        return `${API_ORIGIN}/uploads/${nomFichier}`;
    }

    return `${API_ORIGIN}/${p}`;
}

async function openReservationDetails(reservationId, options = {}) {
    const scrollToPhotos = !!options.scrollToPhotos;
    try {
        const res = await fetch(`${API_URL}/reservations/${reservationId}`);
        const result = await res.json();

        if (!result.success) {
            alert(result.message || 'Impossible de charger la réservation');
            return;
        }

        const detailContent = document.getElementById('detailContent');
        const modal = document.getElementById('detailModal');
        if (!detailContent || !modal) return;

        const r = result.data || {};
        const images = Array.isArray(r.images) ? r.images : [];
        const nom = r.client_nom || r.nom || '';
        const tel = r.client_telephone || r.telephone || '—';
        const email = r.client_email || r.email || '';
        const modele = r.modele_vehicule || r.model || '—';
        const annee = r.annee_vehicule || r.year || '';
        const vehicule = `${escapeHtml(modele)}${annee ? ' · ' + escapeHtml(annee) : ''}`;
        const servicesStr = r.services_noms || r.services || '';
        const servicesHtml = servicesStr
            ? escapeHtml(servicesStr).replace(/\n/g, '<br>')
            : '<span style="color:var(--silver)">—</span>';
        const msg = r.message_client || r.message || '';
        const pb = parseFloat(r.prix_base) || 0;
        const pf = parseFloat(r.prix_final) || 0;
        const rem = parseFloat(r.remise) || 0;
        const prixBlock = pf > 0
            ? `<div class="detail-item"><strong>Prix final:</strong> ${escapeHtml(formatPrice(pf))}</div>
               ${pb > 0 ? `<div class="detail-item"><strong>Prix de base:</strong> ${escapeHtml(formatPrice(pb))}</div>` : ''}
               ${rem > 0 ? `<div class="detail-item"><strong>Remise (montant):</strong> ${escapeHtml(formatPrice(rem))}</div>` : ''}`
            : `<div class="detail-item"><strong>Prix:</strong> <span style="color:var(--silver)">À définir</span></div>`;
        const statut = r.statut || '—';
        const dateRes = r.date_reservation
            ? new Date(r.date_reservation).toLocaleString('fr-FR')
            : '—';
        const orderId = String(r.order_id || r.id || reservationId);

        const imagesHtml = images.length
            ? images.map(img => {
                const src = buildImageSrc(img.chemin_fichier, img.nom_fichier);
                const safeSrc = escapeHtml(src);
                const alt = escapeHtml(img.nom_fichier || 'photo');
                return `
                    <div class="image-item">
                        <img src="${safeSrc}" alt="${alt}" onclick="window.open('${safeSrc}', '_blank')" />
                    </div>
                `;
            }).join('')
            : '<p style="color:var(--silver);padding:1rem;text-align:center;">Aucune photo</p>';

        detailContent.innerHTML = `
            <div class="detail-grid">
                <div class="detail-section full-width">
                    <h4>📋 Commande #${escapeHtml(orderId)}</h4>
                    <div class="detail-item"><strong>Client:</strong> ${escapeHtml(nom)}</div>
                    <div class="detail-item"><strong>Téléphone:</strong> ${escapeHtml(tel)}</div>
                    ${email ? `<div class="detail-item"><strong>Email:</strong> ${escapeHtml(email)}</div>` : ''}
                    <div class="detail-item"><strong>Véhicule:</strong> ${vehicule}</div>
                    <div class="detail-item"><strong>Services:</strong><br><span style="display:inline-block;margin-top:0.35rem">${servicesHtml}</span></div>
                    ${prixBlock}
                    <div class="detail-item"><strong>Statut:</strong> ${escapeHtml(statut)}</div>
                    <div class="detail-item"><strong>Date réservation:</strong> ${escapeHtml(dateRes)}</div>
                </div>
                <div class="detail-section full-width">
                    <h4>💬 Message du client</h4>
                    <div class="detail-message-full">${msg ? escapeHtml(msg) : '<span style="color:var(--silver)">Aucun message</span>'}</div>
                </div>
                <div class="detail-section full-width" id="detailPhotosSection">
                    <h4>📸 Photos (${images.length})</h4>
                    <div class="images-grid">
                        ${imagesHtml}
                    </div>
                </div>
            </div>
        `;

        modal.style.display = 'block';
        if (scrollToPhotos) {
            requestAnimationFrame(() => {
                const el = document.getElementById('detailPhotosSection');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        }
    } catch (error) {
        console.error('❌ openReservationDetails:', error);
        alert('Erreur lors du chargement des détails');
    }
}

async function openReservationPhotos(reservationId) {
    return openReservationDetails(reservationId, { scrollToPhotos: true });
}

window.openReservationDetails = openReservationDetails;

// ============================================
// PRIX / MODIFIER / AJOUTER RÉSERVATION (ADMIN)
// ============================================
function openPriceModal(reservationId) {
    const order = allOrders.find(o => Number(o.id) === Number(reservationId));
    if (!order) return;

    document.getElementById('priceReservationId').value = order.id;
    const servicesListEl = document.getElementById('priceServicesList');
    const baseInput = document.getElementById('priceBaseInput');
    const finalInput = document.getElementById('priceFinalInput');
    const discountInput = document.getElementById('priceDiscountPercentInput');
    const delaiEl = document.getElementById('priceDelaiInput');
    if (delaiEl) delaiEl.value = order.delaiRemise || '';

    const loyaltyRemise = !!order.isFidele;
    currentPriceHasRemise = loyaltyRemise;
    const indicator = document.getElementById('priceRemiseIndicator');
    if (indicator) indicator.textContent = loyaltyRemise ? 'Oui (fidélité -20 %)' : 'Non';

    const serviceNames = Array.isArray(order.services) && order.services.length ? order.services : ['Service'];
    const perService = serviceNames.length > 0 ? Math.round((order.basePrice || 0) / serviceNames.length) : 0;
    currentPriceServices = serviceNames.map((serviceName) => ({
        name: serviceName,
        price: Math.max(0, perService)
    }));

    if (servicesListEl) {
        servicesListEl.innerHTML = currentPriceServices.map((svc, idx) => `
            <div class="price-service-row">
                <span class="price-service-name">${escapeHtml(svc.name)}</span>
                <input
                    type="number"
                    min="0"
                    step="1"
                    class="price-service-input"
                    data-index="${idx}"
                    value="${Math.max(0, Number(svc.price) || 0)}"
                    placeholder="0"
                />
            </div>
        `).join('');
    }

    const persistedDiscountPercent = (order.basePrice || 0) > 0 && (order.remise || 0) > 0
        ? ((order.remise / order.basePrice) * 100)
        : 0;
    const effectiveDiscountPercent = currentPriceHasRemise
        ? 20
        : persistedDiscountPercent;

    if (discountInput) {
        discountInput.value = effectiveDiscountPercent > 0 ? Number(effectiveDiscountPercent.toFixed(2)) : 0;
        discountInput.readOnly = currentPriceHasRemise;
    }
    if (baseInput) {
        baseInput.value = Math.max(0, Number(order.basePrice) || 0);
    }
    if (finalInput) {
        finalInput.value = Math.max(0, Number(order.finalPrice) || 0);
    }

    recalculatePriceModalTotals();
    document.getElementById('priceModal').style.display = 'block';
}

document.addEventListener('DOMContentLoaded', () => {
    const baseInput = document.getElementById('priceBaseInput');
    const finalInput = document.getElementById('priceFinalInput');
    const discountInput = document.getElementById('priceDiscountPercentInput');
    const servicesList = document.getElementById('priceServicesList');

    if (baseInput && finalInput && discountInput && servicesList) {
        discountInput.addEventListener('input', recalculatePriceModalTotals);
        servicesList.addEventListener('input', (e) => {
            const target = e.target;
            if (!(target instanceof HTMLInputElement)) return;
            if (!target.classList.contains('price-service-input')) return;
            const idx = Number(target.dataset.index);
            if (Number.isNaN(idx) || !currentPriceServices[idx]) return;
            currentPriceServices[idx].price = Math.max(0, parseFloat(target.value || '0') || 0);
            recalculatePriceModalTotals();
        });
    }
});

function recalculatePriceModalTotals() {
    const baseInput = document.getElementById('priceBaseInput');
    const finalInput = document.getElementById('priceFinalInput');
    const discountInput = document.getElementById('priceDiscountPercentInput');
    if (!baseInput || !finalInput || !discountInput) return;

    const base = currentPriceServices.reduce((sum, svc) => sum + (Math.max(0, Number(svc.price) || 0)), 0);
    let discountPercent = Math.max(0, Number(discountInput.value) || 0);
    if (currentPriceHasRemise) discountPercent = 20;
    if (discountPercent > 100) discountPercent = 100;
    discountInput.value = Number(discountPercent.toFixed(2));

    const finalPrice = Math.round(base * (1 - (discountPercent / 100)));
    baseInput.value = Math.round(base);
    finalInput.value = Math.max(0, finalPrice);
}

async function submitPriceUpdate() {
    const id = document.getElementById('priceReservationId').value;
    recalculatePriceModalTotals();
    const prix_base = parseFloat(document.getElementById('priceBaseInput').value || '0');
    const prix_final = parseFloat(document.getElementById('priceFinalInput').value || '0');

    if (!id) return;
    if (Number.isNaN(prix_base) || Number.isNaN(prix_final)) {
        alert('Prix invalide');
        return;
    }
    const remise = Math.max(0, (prix_base || 0) - (prix_final || 0));
    const delaiRemise = (document.getElementById('priceDelaiInput')?.value || '').trim();

    try {
        const res = await fetch(`${API_URL}/reservations/${id}/price`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prix_base,
                prix_final,
                remise,
                delai_remise: delaiRemise || null,
                services_pricing: currentPriceServices.map((svc) => ({
                    name: String(svc.name || '').trim(),
                    price: Math.max(0, Number(svc.price) || 0)
                }))
            })
        });
        const result = await res.json();
        if (!result.success) {
            alert(result.message || 'Erreur lors de la mise à jour');
            return;
        }

        closeModal('priceModal');
        loadOrders();
        updatePendingBadge();
    } catch (error) {
        console.error(error);
        alert('Erreur serveur');
    }
}

function openEditReservationModal(reservationId) {
    const order = allOrders.find(o => Number(o.id) === Number(reservationId));
    if (!order) return;

    document.getElementById('editReservationId').value = order.id;
    document.getElementById('editNameInput').value = order.name || '';
    document.getElementById('editPhoneInput').value = order.phone || '';
    document.getElementById('editEmailInput').value = order.email || '';
    document.getElementById('editModelInput').value = order.model || '';
    document.getElementById('editYearInput').value = order.year || '';
    document.getElementById('editMessageInput').value = order.message || '';

    document.getElementById('editModal').style.display = 'block';
}

async function submitEditReservation() {
    const id = document.getElementById('editReservationId').value;
    const name = document.getElementById('editNameInput').value.trim();
    const phone = document.getElementById('editPhoneInput').value.trim();
    const email = document.getElementById('editEmailInput').value.trim();
    const model = document.getElementById('editModelInput').value.trim();
    const year = document.getElementById('editYearInput').value;
    const message = document.getElementById('editMessageInput').value.trim();

    if (!id) return;
    if (!name || !phone) {
        alert('Nom et téléphone sont obligatoires');
        return;
    }

    try {
        const res = await fetch(`${API_URL}/reservations/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone, email: email || null, model, year, message })
        });
        const result = await res.json();
        if (!result.success) {
            alert(result.message || 'Erreur');
            return;
        }

        closeModal('editModal');
        loadOrders();
        updatePendingBadge();
    } catch (error) {
        console.error(error);
        alert('Erreur serveur');
    }
}

function openAddReservationModal() {
    document.getElementById('addNameInput').value = '';
    document.getElementById('addPhoneInput').value = '';
    document.getElementById('addEmailInput').value = '';
    document.getElementById('addModelInput').value = '';
    document.getElementById('addYearInput').value = '';
    document.getElementById('addMessageInput').value = '';
    document.querySelectorAll('#addModal .service-checkbox').forEach(cb => { cb.checked = false; });
    document.getElementById('addModal').style.display = 'block';
}

async function submitAddReservation() {
    const name = document.getElementById('addNameInput').value.trim();
    const phone = document.getElementById('addPhoneInput').value.trim();
    const email = document.getElementById('addEmailInput').value.trim();
    const model = document.getElementById('addModelInput').value.trim();
    const year = document.getElementById('addYearInput').value;
    const message = document.getElementById('addMessageInput').value.trim();

    if (!name || !phone) {
        alert('Nom et téléphone obligatoires');
        return;
    }

    const formData = new FormData();
    formData.append('name', name);
    formData.append('phone', phone);
    formData.append('email', email || '');
    formData.append('model', model);
    formData.append('year', year);
    formData.append('message', message);
    const selectedServices = Array.from(
        document.querySelectorAll('#addModal .service-checkbox:checked')
    ).map(cb => ({
        value: cb.dataset.code || cb.value,
        name: cb.dataset.name || cb.value || '',
        price: 0
    }));
    formData.append('services', JSON.stringify(selectedServices));
    formData.append('basePrice', 0);
    formData.append('discount', 0);
    formData.append('finalPrice', 0);

    try {
        const res = await fetch(`${API_URL}/reservations`, {
            method: 'POST',
            body: formData
        });
        const result = await res.json();
        if (!result.success) {
            alert(result.message || 'Erreur');
            return;
        }

        closeModal('addModal');
        loadOrders();
        updatePendingBadge();
    } catch (error) {
        console.error(error);
        alert('Erreur serveur');
    }
}

// ============================================
// DEMANDES D'ACCÈS
// ============================================
async function loadPendingRequests() {
    if (!authToken || currentUser?.role !== 'admin') return;
    try {
        const response = await fetch(`${API_URL}/auth/pending-requests`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const result = await response.json();
        if (result.success) {
            displayDemandes(result.data);
            document.getElementById('demandesCount').textContent = result.count;
        }
    } catch (error) {
        console.error('Erreur:', error);
    }
}

function displayDemandes(demandes) {
    const grid = document.getElementById('demandesGrid');
    if (!demandes.length) {
        grid.innerHTML = '<p style="text-align:center;color:var(--silver);padding:3rem;">Aucune demande</p>';
        return;
    }
    grid.innerHTML = demandes.map(d => `
        <div class="demande-card">
            <h4>${d.nom_complet}</h4>
            <p><strong>Email:</strong> ${d.email}</p>
            <p><strong>Téléphone:</strong> ${d.telephone || 'Non fourni'}</p>
            <p><strong>Username:</strong> ${d.username}</p>
            ${d.message_demande ? `<p><strong>Message:</strong> ${d.message_demande}</p>` : ''}
            <p><small>Demandé le: ${new Date(d.date_demande).toLocaleString('fr-FR')}</small></p>
            <div class="demande-actions">
                <button onclick="approveUser(${d.user_id})" class="btn btn-success btn-small">✅ Approuver</button>
                <button onclick="rejectUser(${d.user_id})" class="btn btn-danger btn-small">❌ Refuser</button>
            </div>
        </div>`).join('');
}

async function approveUser(userId) {
    if (!confirm('Approuver cet utilisateur ?')) return;
    try {
        const r = await fetch(`${API_URL}/auth/approve/${userId}`, {
            method: 'PUT', headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const result = await r.json();
        if (result.success) { showMessage('✅ Approuvé !', 'success'); loadPendingRequests(); }
    } catch (e) { console.error(e); }
}

async function rejectUser(userId) {
    const raison = prompt('Raison du refus (optionnel):');
    if (raison === null) return;
    try {
        const r = await fetch(`${API_URL}/auth/reject/${userId}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ raison })
        });
        const result = await r.json();
        if (result.success) { showMessage('✅ Refusé', 'success'); loadPendingRequests(); }
    } catch (e) { console.error(e); }
}

// ============================================
// MESSAGERIE ADMIN
// ============================================
function initAdminMessaging() {
    if (typeof io === 'undefined') return;
    if (adminSocket && adminSocket.connected) return;
    adminSocket = io(API_ORIGIN, { transports: ['websocket', 'polling'] });
    adminSocket.on('connect', () => {
        const adminId = currentUser?.id || 'admin';
        adminSocket.emit('register', adminId, 'admin');
        if (currentAdminConversationId) adminSocket.emit('join_conversation', currentAdminConversationId);
    });
    adminSocket.on('receive_message', (data) => {
        const convId = Number(data.conversation_id || data.conversationId);
        if (convId === currentAdminConversationId && data.sender_type !== 'admin') {
            displayAdminMessage(data);
            scrollAdminChatToBottom();
        } else {
            const badge = document.getElementById('messagesUnreadBadge');
            if (badge) badge.textContent = parseInt(badge.textContent || '0') + 1;
            loadAdminConversations();
        }
    });

    adminSocket.on('messages_status_updated', (payload) => {
        if (Number(payload.conversationId) === Number(currentAdminConversationId)) {
            refreshAdminMessageStatuses().then(() => scrollAdminChatToBottom());
        }
    });

    adminSocket.on('message_deleted', (payload) => {
        const el = document.querySelector(`#adminChatMessages .admin-chat-row[data-message-id="${payload.messageId}"]`);
        if (el) el.remove();
    });

    adminSocket.on('conversation_deleted', (payload) => {
        const cid = Number(payload && payload.conversationId);
        loadAdminConversations();
        if (cid && cid === Number(currentAdminConversationId)) {
            currentAdminConversationId = null;
            const box = document.getElementById('adminChatMessages');
            if (box) box.innerHTML = '';
            const nameEl = document.getElementById('adminChatClientName');
            const subEl = document.getElementById('adminChatSubtitle');
            if (nameEl) nameEl.textContent = 'Sélectionnez une conversation';
            if (subEl) subEl.textContent = '';
        }
    });
}

async function loadAdminConversations() {
    try {
        const res = await fetch(`${API_URL}/chat/conversations`);
        const result = await res.json();
        if (result.success) {
            adminConversations = result.data || [];
            // [MOD 4] Appliquer le filtre de recherche si actif
            renderAdminConversationsList(adminConversations);
            const totalUnread = adminConversations.reduce((sum, c) => sum + (parseInt(c.unread_from_client) || 0), 0);
            const badge = document.getElementById('messagesUnreadBadge');
            if (badge) badge.textContent = totalUnread;
        }
    } catch (error) { console.error('❌ Erreur conversations:', error); }
}

// [MOD 4] Filtre de recherche dans les conversations
function filterAdminConversations() {
    const q = adminConvSearchQuery.toLowerCase().trim();
    if (!q) {
        renderAdminConversationsList(adminConversations);
        return;
    }
    const filtered = adminConversations.filter(conv =>
        (conv.client_name  || '').toLowerCase().includes(q) ||
        (conv.telephone    || '').toLowerCase().includes(q) ||
        (conv.last_message || '').toLowerCase().includes(q)
    );
    renderAdminConversationsList(filtered);
}

// [MOD 4] Renommage de l'ancienne displayAdminConversations pour séparer data/rendu
function displayAdminConversations(conversations) {
    renderAdminConversationsList(conversations);
}

function renderAdminConversationsList(conversations) {
    const list = document.getElementById('adminConversationsList');
    if (!list) return;
    if (!conversations.length) {
        list.innerHTML = '<p style="padding:1rem;color:var(--silver);text-align:center;">Aucune conversation</p>';
        return;
    }
    list.innerHTML = conversations.map(conv => {
        const date = conv.last_message_at ? new Date(conv.last_message_at) : null;
        const timeStr = date ? date.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        const unread = parseInt(conv.unread_from_client) || 0;
        const activeClass = Number(conv.id) === Number(currentAdminConversationId) ? 'active' : '';
        return `
            <div class="admin-chat-conv-item ${activeClass}" onclick="openAdminConversation(${conv.id})">
                <div class="admin-chat-conv-title">
                    <span class="admin-chat-conv-name">${conv.client_name}</span>
                    <span class="admin-chat-conv-time">${timeStr}</span>
                </div>
                <div class="admin-chat-conv-preview">
                    ${conv.last_message || 'Aucun message'}
                    ${unread > 0 ? `<span class="admin-chat-conv-unread">${unread}</span>` : ''}
                </div>
                <div style="font-size:0.75rem;color:var(--silver)">📞 ${conv.telephone || '—'}</div>
            </div>`;
    }).join('');
}

async function openAdminConversation(conversationId) {
    currentAdminConversationId = Number(conversationId);
    const conv = adminConversations.find((c) => Number(c.id) === Number(conversationId));
    currentAdminClientName = conv ? conv.client_name : '';
    const nameEl = document.getElementById('adminChatClientName');
    const subEl = document.getElementById('adminChatSubtitle');
    if (nameEl) nameEl.textContent = currentAdminClientName || 'Conversation';
    if (subEl) subEl.textContent = conv ? `Client: ${conv.telephone || ''}` : '';
    if (adminSocket?.connected) adminSocket.emit('join_conversation', conversationId);
    try {
        const res = await fetch(`${API_URL}/chat/messages/${conversationId}`);
        const result = await res.json();
        if (result.success) {
            renderAdminMessages(result.data || []);
            await fetch(`${API_URL}/chat/conversations/${conversationId}/mark-delivered`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewerType: 'admin' }) });
            await fetch(`${API_URL}/chat/conversations/${conversationId}/mark-read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewerType: 'admin' }) });
            refreshAdminMessageStatuses();
            loadAdminConversations();
        }
    } catch (error) { console.error('❌ Erreur:', error); }
}

function renderAdminMessages(messages) {
    const container = document.getElementById('adminChatMessages');
    if (!container) return;
    container.innerHTML = '';
    messages.forEach(msg => displayAdminMessage(msg, container));
    scrollAdminChatToBottom();
}

// [MOD 1] displayAdminMessage — suppression du bouton 🗑️ inline ; clic droit uniquement
function displayAdminMessage(msg, containerOverride = null) {
    const container = containerOverride || document.getElementById('adminChatMessages');
    if (!container) return;
    const isMe = msg.sender_type === 'admin';
    const row = document.createElement('div');
    row.className = 'admin-chat-row ' + (isMe ? 'me' : 'other');
    row.dataset.messageId = msg.id;

    // [MOD 1] Clic droit sur TOUTE la bulle pour supprimer (plus de bouton inline)
    row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showAdminMessageContextMenu(e, msg.id);
    });

    const inner = document.createElement('div');
    inner.className = 'admin-chat-row-inner';

    const bubble = document.createElement('div');
    bubble.className = 'admin-chat-message ' + (isMe ? 'me' : 'other');
    if (msg.message_type === 'image' && msg.file_path) {
        const src = buildImageSrc(msg.file_path, '');
        const wrap = document.createElement('div');
        wrap.className = 'admin-msg-media-wrap';
        const img = document.createElement('img');
        img.src = src;
        img.alt = 'Image';
        img.loading = 'lazy';
        img.addEventListener('click', () => window.open(src, '_blank'));
        wrap.appendChild(img);
        bubble.appendChild(wrap);
    } else if (msg.message_type === 'audio' && msg.file_path) {
        const src = buildImageSrc(msg.file_path, '');
        bubble.innerHTML = `<audio controls style="width:180px;max-width:100%;"><source src="${src}" type="audio/webm"></audio>`;
    } else if (msg.message_type === 'video' && msg.file_path) {
        const src = buildImageSrc(msg.file_path, '');
        const wrap = document.createElement('div');
        wrap.className = 'admin-msg-media-wrap';
        const vid = document.createElement('video');
        vid.setAttribute('controls', '');
        const s = document.createElement('source');
        s.src = src;
        s.type = 'video/mp4';
        vid.appendChild(s);
        wrap.appendChild(vid);
        bubble.appendChild(wrap);
    } else {
        if (msg.message_text) {
            bubble.textContent = msg.message_text;
        } else {
            const t = msg.message_type || 'message';
            const label = t === 'image' ? '[Photo]' : (t === 'audio' ? '[Vocal]' : (t === 'video' ? '[Video]' : '[Message]'));
            bubble.textContent = label;
        }
    }

    // [MOD 1] Pas de bouton 🗑️ ajouté ici — clic droit uniquement
    inner.appendChild(bubble);
    row.appendChild(inner);

    const meta = document.createElement('div');
    meta.className = 'admin-chat-meta';
    const timeSpan = document.createElement('span');
    timeSpan.textContent = new Date(msg.created_at || Date.now()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    meta.appendChild(timeSpan);
    if (isMe) {
        const statusSpan = document.createElement('span');
        statusSpan.className = 'msg-status';
        statusSpan.dataset.messageId = msg.id;
        setAdminMessageStatusSpan(statusSpan, msg.status);
        meta.appendChild(statusSpan);
    }
    row.appendChild(meta);
    container.appendChild(row);
    if (!containerOverride) scrollAdminChatToBottom();
}

async function deleteAdminMessage(messageId) {
    if (!confirm('Supprimer ce message ?')) {
        closeAdminMessageContextMenu();
        return;
    }
    try {
        const res = await fetch(`${API_URL}/chat/messages/${messageId}`, { method: 'DELETE' });
        const result = await res.json();
        if (result.success) {
            document.querySelector(`#adminChatMessages .admin-chat-row[data-message-id="${messageId}"]`)?.remove();
            closeAdminMessageContextMenu();
            if (adminSocket?.connected) {
                adminSocket.emit('delete_message', {
                    messageId,
                    conversationId: currentAdminConversationId
                });
            }
            loadAdminConversations();
        } else {
            alert(result.message || 'Suppression impossible');
            closeAdminMessageContextMenu();
        }
    } catch (e) {
        console.error(e);
        closeAdminMessageContextMenu();
    }
}

async function deleteAdminConversation() {
    if (!currentAdminConversationId) {
        alert('Sélectionnez une conversation');
        return;
    }
    if (!confirm('Supprimer toute la conversation ? Cette action est définitive.')) return;
    try {
        const res = await fetch(
            `${API_URL}/chat/conversations/${currentAdminConversationId}/delete`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
        );
        const result = await res.json();
        if (result.success) {
            currentAdminConversationId = null;
            const box = document.getElementById('adminChatMessages');
            if (box) box.innerHTML = '';
            const nameEl = document.getElementById('adminChatClientName');
            const subEl = document.getElementById('adminChatSubtitle');
            if (nameEl) nameEl.textContent = 'Sélectionnez une conversation';
            if (subEl) subEl.textContent = '';
            loadAdminConversations();
        } else {
            alert(result.message || 'Erreur');
        }
    } catch (e) {
        console.error(e);
        alert('Erreur serveur');
    }
}

window.deleteAdminMessage = deleteAdminMessage;
window.deleteAdminConversation = deleteAdminConversation;

function handleAdminChatKeyPress(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAdminChatText(e); }
}

async function sendAdminChatText(event) {
    if (event) event.preventDefault();
    if (!currentAdminConversationId) return;
    const input = document.getElementById('adminChatMessageInput');
    const text = input.value.trim();
    if (!text) return;
    try {
        const res = await fetch(`${API_URL}/chat/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId: currentAdminConversationId, senderType: 'admin', text })
        });
        const data = await res.json();
        if (data.success) {
            displayAdminMessage(data.message);
            if (adminSocket?.connected) adminSocket.emit('send_message', { ...data.message, conversation_id: currentAdminConversationId });
            input.value = '';
            scrollAdminChatToBottom();
            loadAdminConversations();
        }
    } catch (error) { console.error('❌ Erreur:', error); }
}

async function sendAdminChatImage(inputEl) {
    const file = inputEl.files?.[0];
    if (!file || !currentAdminConversationId) return;
    const formData = new FormData();
    formData.append('conversationId', currentAdminConversationId);
    formData.append('senderType', 'admin');
    formData.append('file', file);
    try {
        const res = await fetch(`${API_URL}/chat/messages`, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            displayAdminMessage(data.message);
            if (adminSocket?.connected) adminSocket.emit('send_message', { ...data.message, conversation_id: currentAdminConversationId });
            scrollAdminChatToBottom();
            loadAdminConversations();
        }
    } catch (error) { console.error('❌ Erreur:', error); }
    finally { inputEl.value = ''; }
}

// ============================================
// ENREGISTREMENT AUDIO ADMIN
// ============================================
function initAdminAudioRecording() {
    const recordBtn = document.getElementById('adminRecordAudioBtn');
    if (!recordBtn) return;

    let pressTimer;

    recordBtn.addEventListener('mousedown', () => {
        pressTimer = setTimeout(() => startAdminRecording(), 200);
    });

    recordBtn.addEventListener('mouseup', () => {
        clearTimeout(pressTimer);
        if (isAdminRecording) stopAdminRecording();
    });

    recordBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        pressTimer = setTimeout(() => startAdminRecording(), 200);
    });

    recordBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        clearTimeout(pressTimer);
        if (isAdminRecording) stopAdminRecording();
    });
}

function startAdminRecording() {
    if (isAdminRecording || !currentAdminConversationId) return;

    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            isAdminRecording = true;
            adminRecordingStartTime = Date.now();
            adminAudioChunks = [];

            let mime = '';
            if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                mime = 'audio/webm;codecs=opus';
            } else if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm')) {
                mime = 'audio/webm';
            }

            adminMediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);

            adminMediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) adminAudioChunks.push(e.data);
            };
            try {
                adminMediaRecorder.start(250);
            } catch (e) {
                adminMediaRecorder.start();
            }

            const btn = document.getElementById('adminRecordAudioBtn');
            if (btn) {
                btn.textContent = '⏹️';
                btn.style.color = '#e74c3c';
                btn.style.transform = 'scale(1.2)';
            }

            console.log('🎤 Admin: Enregistrement démarré');
        })
        .catch(() => {
            alert('❌ Accès microphone refusé');
            isAdminRecording = false;
        });
}

function stopAdminRecording() {
    if (!isAdminRecording || !adminMediaRecorder || adminMediaRecorder.state === 'inactive') return;

    const rec = adminMediaRecorder;
    const stream = rec.stream;
    const chunksSnapshot = adminAudioChunks.slice();

    rec.onstop = () => {
        const duration = Math.floor((Date.now() - adminRecordingStartTime) / 1000);
        console.log(`🎤 Admin: Audio enregistré: ${duration}s`);

        const blobType = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunksSnapshot, { type: blobType });
        if (!blob.size) {
            alert('❌ Enregistrement vide : maintenez le bouton un peu plus longtemps.');
            stream.getTracks().forEach((track) => track.stop());
            return;
        }

        const file = new File([blob], `admin-vocal-${Date.now()}.webm`, { type: blobType.includes('webm') ? blobType : 'audio/webm' });

        const formData = new FormData();
        formData.append('conversationId', String(currentAdminConversationId));
        formData.append('senderType', 'admin');
        formData.append('file', file);

        fetch(`${API_URL}/chat/messages`, {
            method: 'POST',
            body: formData
        }).then((r) => r.json()).then((data) => {
            if (data.success) {
                displayAdminMessage(data.message);
                if (adminSocket?.connected) {
                    adminSocket.emit('send_message', {
                        ...data.message,
                        conversation_id: currentAdminConversationId
                    });
                }
                scrollAdminChatToBottom();
                console.log('✅ Admin: Audio envoyé');
                loadAdminConversations();
            } else {
                alert(data.message || '❌ Envoi vocal refusé');
            }
        }).catch((err) => {
            console.error('❌ Erreur:', err);
        });

        stream.getTracks().forEach((track) => track.stop());
    };

    isAdminRecording = false;

    const btn = document.getElementById('adminRecordAudioBtn');
    if (btn) {
        btn.textContent = '🎤';
        btn.style.color = '';
        btn.style.transform = '';
    }

    try {
        if (rec.state === 'recording') rec.requestData();
    } catch (e) { /* ignore */ }

    rec.stop();
}

console.log('✅ Admin Panel COMPLET chargé!');