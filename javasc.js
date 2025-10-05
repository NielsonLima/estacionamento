// ======= CONFIGURAÇÃO DO FIREBASE =======
const firebaseConfig = {
    apiKey: "AIzaSyAQetgrWjXeqvY0vqiCWbyBTrtrPK5CsMs",
    authDomain: "estacionamentogaranhuns.firebaseapp.com",
    projectId: "estacionamentogaranhuns",
    storageBucket: "estacionamentogaranhuns.appspot.com",
    messagingSenderId: "966360238169",
    appId: "1:966360238169:web:f1610f026b7e269ea74948",
    measurementId: "G-PZ05G1QLHG"
};

// ======= INICIALIZAÇÃO DO FIREBASE =======
let app, db, auth;

try {
    if (!firebase.apps.length) {
        app = firebase.initializeApp(firebaseConfig);
    } else {
        app = firebase.app();
    }
    
    const analytics = firebase.analytics();
    db = firebase.firestore();
    auth = firebase.auth();
    
    // Configurações do Firestore para melhor desempenho
    db.settings({
        cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED
    });
    
    // Habilita persistência offline
    db.enablePersistence()
        .catch((err) => {
            console.warn('Persistência offline não suportada:', err.code);
        });
    
    console.log('Firebase inicializado com sucesso!');
    
} catch (error) {
    console.error('Erro ao inicializar Firebase:', error);
    showError('Erro de configuração do Firebase: ' + error.message);
}

// ======= ESTADO GLOBAL =======
let currentUser = null;
let currentEstablishment = null;
let establishments = [];
let TOTAL_SPOTS = 20;
let spots = Array.from({length: TOTAL_SPOTS}, () => null);
let currentIndex = null;
let checkInterval = null;
let unsubscribeSpots = null;

// ======= CONFIGURAÇÕES PADRÃO =======
const DEFAULT_RATES = {
    carro: {
        comerciario: {first:2, additional:2, daily:15},
        usuario: {first:4, additional:3, daily:25}
    },
    moto: {
        comerciario: {first:2, additional:1, daily:10},
        usuario: {first:3, additional:2, daily:15}
    }
};
const TOLERANCE_MIN = 15;
const DIARY_THRESHOLD_HOURS = 9;
const PAID_GRACE_MIN = 15;

// ======= FUNÇÕES DE UTILIDADE =======
function setLoading(button, isLoading, text = '') {
    if (isLoading) {
        button.disabled = true;
        button.dataset.originalText = button.textContent;
        button.textContent = text || 'Carregando...';
    } else {
        button.disabled = false;
        button.textContent = button.dataset.originalText || text;
    }
}

function validatePlate(plate) {
    if (!plate) return true;
    const plateRegex = /^[A-Z]{3}[-]?[0-9][A-Z0-9][0-9]{2}$/;
    return plateRegex.test(plate.toUpperCase().replace(/\s/g, ''));
}

function escapeHtml(s) { 
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); 
}

function getRadio(name) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : null;
}

function formatForDatetimeLocal(date) {
    const dt = new Date(date);
    const off = dt.getTimezoneOffset();
    const local = new Date(dt.getTime() - off * 60000);
    return local.toISOString().slice(0, 16);
}

function parseDatetimeLocal(v) {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
}

function minutesBetween(a, b) {
    return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

function showError(message) {
    console.error('Erro:', message);
    const errorPanel = document.getElementById('errorPanel');
    if (errorPanel) {
        errorPanel.innerHTML = `<h3>Erro no Sistema</h3><p>${message}</p>`;
        errorPanel.style.display = 'block';
    }
}

// ======= SISTEMA DE GERENCIAMENTO DE USUÁRIOS =======
async function checkAndCreateUserDocument(user) {
    try {
        const userDoc = await db.collection('users').doc(user.uid).get();
        
        if (!userDoc.exists) {
            // Cria documento do usuário se não existir
            await db.collection('users').doc(user.uid).set({
                email: user.email,
                establishments: [],
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log('Novo documento de usuário criado:', user.uid);
        } else {
            // Atualiza último login
            await db.collection('users').doc(user.uid).update({
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
    } catch (error) {
        console.error('Erro ao verificar/criar documento do usuário:', error);
        throw error;
    }
}

// ======= FUNÇÕES DE AUTENTICAÇÃO =======
function initAuth() {
    if (!firebase.apps.length) {
        console.error('Firebase não inicializado');
        showError('Firebase não foi inicializado corretamente.');
        return;
    }
    
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            try {
                currentUser = user;
                document.getElementById('currentUserEmail').textContent = user.email;
                
                // Verifica e cria documento do usuário se necessário
                await checkAndCreateUserDocument(user);
                
                // Carrega estabelecimentos do usuário
                await loadUserEstablishments();
                
            } catch (error) {
                console.error('Erro no fluxo de autenticação:', error);
                showError('Erro ao inicializar usuário: ' + error.message);
                await auth.signOut();
            }
        } else {
            currentUser = null;
            currentEstablishment = null;
            showLoginScreen();
        }
    }, (error) => {
        console.error('Erro no observador de autenticação:', error);
        showLoginScreen();
    });
}

function showLoginScreen() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('establishmentModal').style.display = 'none';
    document.getElementById('mainSystem').style.display = 'none';
    document.getElementById('loginForm').reset();
    document.getElementById('loginError').style.display = 'none';
}

// ======= GERENCIAMENTO DE ESTABELECIMENTOS =======
async function loadUserEstablishments() {
    try {
        console.log('Carregando estabelecimentos para usuário:', currentUser.uid);
        
        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        
        if (userDoc.exists) {
            establishments = userDoc.data().establishments || [];
            console.log('Estabelecimentos encontrados:', establishments);
            
            // Se o usuário tem apenas um estabelecimento, entra automaticamente
            if (establishments.length === 1) {
                console.log('Apenas um estabelecimento encontrado, entrando automaticamente...');
                await loadEstablishment(establishments[0]);
                return;
            }
        } else {
            console.log('Documento do usuário não encontrado, criando novo...');
            await db.collection('users').doc(currentUser.uid).set({
                email: currentUser.email,
                establishments: [],
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            });
            establishments = [];
        }
        
        showEstablishmentModal();
        
    } catch (error) {
        console.error('Erro ao carregar estabelecimentos:', error);
        if (error.code === 'permission-denied') {
            showError('Sem permissão para acessar estabelecimentos. Contate o administrador.');
        } else {
            showError('Erro ao carregar estabelecimentos: ' + error.message);
        }
        showEstablishmentModal();
    }
}

// ======= FUNÇÃO PARA CARREGAR LISTA DE ESTABELECIMENTOS NO MODAL =======
async function loadEstablishmentsList() {
    const select = document.getElementById('establishmentSelect');
    const helpText = document.getElementById('establishmentHelp');
    
    select.innerHTML = '<option value="">Carregando estabelecimentos...</option>';
    
    if (!establishments || establishments.length === 0) {
        select.innerHTML = '<option value="">Nenhum estabelecimento disponível</option>';
        if (helpText) {
            helpText.textContent = 'Você não tem acesso a nenhum estabelecimento.';
        }
        return;
    }
    
    let establishmentsLoaded = 0;
    let permissionErrors = 0;
    const lastEstablishmentId = localStorage.getItem('lastEstablishment');
    
    // Limpa o select
    select.innerHTML = '<option value="">Selecione um estabelecimento</option>';
    
    for (const estabId of establishments) {
        try {
            console.log('Carregando estabelecimento para seleção:', estabId);
            const estabDoc = await db.collection('estabelecimentos').doc(estabId).get();
            
            if (estabDoc.exists) {
                const estabData = estabDoc.data();
                
                // Verifica se o usuário tem acesso
                if (!estabData.usuarios || !estabData.usuarios.includes(currentUser.uid)) {
                    console.warn(`Usuário não tem acesso ao estabelecimento ${estabId}`);
                    permissionErrors++;
                    continue;
                }
                
                const option = document.createElement('option');
                option.value = estabId;
                option.textContent = `${estabData.nome} - ${estabData.endereco || 'Sem endereço'}`;
                option.dataset.estabName = estabData.nome;
                
                // Seleciona o último estabelecimento usado, se disponível
                if (estabId === lastEstablishmentId) {
                    option.selected = true;
                }
                
                select.appendChild(option);
                establishmentsLoaded++;
            }
        } catch (error) {
            console.error('Erro ao carregar estabelecimento:', estabId, error);
            if (error.code === 'permission-denied') {
                permissionErrors++;
            }
        }
    }
    
    if (establishmentsLoaded === 0) {
        select.innerHTML = '<option value="">Nenhum estabelecimento acessível</option>';
        if (helpText) {
            if (permissionErrors > 0) {
                helpText.textContent = 'Sem permissão para acessar os estabelecimentos.';
            } else {
                helpText.textContent = 'Nenhum estabelecimento pôde ser carregado.';
            }
        }
    } else {
        if (helpText) {
            helpText.textContent = `Carregados ${establishmentsLoaded} estabelecimento(s)`;
        }
    }
}

// ======= FUNÇÃO PARA TROCAR ESTABELECIMENTO =======
async function switchEstablishment() {
    console.log('Trocar estabelecimento clicado');
    
    const button = document.getElementById('btnSwitchEstablishment');
    setLoading(button, true, 'Carregando...');
    
    try {
        // Limpa recursos atuais
        if (unsubscribeSpots) {
            unsubscribeSpots();
            unsubscribeSpots = null;
        }
        
        if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
        }
        
        // Fecha o sistema principal
        document.getElementById('mainSystem').style.display = 'none';
        
        // Mostra o modal de estabelecimento
        document.getElementById('establishmentModal').style.display = 'flex';
        
        // Recarrega a lista de estabelecimentos
        await loadEstablishmentsList();
        
    } catch (error) {
        console.error('Erro ao trocar estabelecimento:', error);
        alert('Erro ao trocar estabelecimento: ' + error.message);
    } finally {
        setLoading(button, false);
    }
}

async function showEstablishmentModal() {
    console.log('Mostrando modal de estabelecimento');
    
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('establishmentModal').style.display = 'flex';
    document.getElementById('mainSystem').style.display = 'none';
    
    // Atualiza o email do usuário
    if (currentUser) {
        document.getElementById('currentUserEmail').textContent = currentUser.email;
    }
    
    // Carrega a lista de estabelecimentos
    await loadEstablishmentsList();
}

async function selectEstablishment() {
    const select = document.getElementById('establishmentSelect');
    const establishmentId = select.value;
    
    if (!establishmentId) {
        alert('Por favor, selecione um estabelecimento');
        return;
    }
    
    const button = document.getElementById('btnSelectEstablishment');
    setLoading(button, true, 'Entrando...');
    
    try {
        await loadEstablishment(establishmentId);
    } catch (error) {
        console.error('Erro ao selecionar estabelecimento:', error);
        alert('Erro ao entrar no estabelecimento: ' + error.message);
    } finally {
        setLoading(button, false);
    }
}

async function loadEstablishment(establishmentId) {
    try {
        console.log('Carregando estabelecimento:', establishmentId);
        
        const estabDoc = await db.collection('estabelecimentos').doc(establishmentId).get();
        
        if (!estabDoc.exists) {
            throw new Error('Estabelecimento não encontrado');
        }
        
        const estabData = estabDoc.data();
        
        // Verifica se usuário tem acesso
        if (!estabData.usuarios || !estabData.usuarios.includes(currentUser.uid)) {
            throw new Error(`Você não tem acesso ao estabelecimento "${estabData.nome}"`);
        }
        
        currentEstablishment = {
            id: establishmentId,
            ...estabData
        };
        
        TOTAL_SPOTS = currentEstablishment.vagas || 20;
        document.getElementById('numSpots').value = TOTAL_SPOTS;
        document.getElementById('establishmentName').textContent = currentEstablishment.nome;
        
        // Salva como último estabelecimento usado
        localStorage.setItem('lastEstablishment', establishmentId);
        
        // Mostra o sistema principal
        showMainSystem();
        
        // Reinicializa o app
        await initApp();
        
    } catch (error) {
        console.error('Erro ao carregar estabelecimento:', error);
        throw error;
    }
}

function showMainSystem() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('establishmentModal').style.display = 'none';
    document.getElementById('mainSystem').style.display = 'block';
    
    if (currentUser && currentEstablishment) {
        document.getElementById('userInfo').innerHTML = `
            ${currentUser.email} | 
            <strong>${currentEstablishment.nome}</strong>
        `;
    }
}

// ======= FUNÇÕES DO SISTEMA PRINCIPAL =======
async function initApp() {
    try {
        updateSyncStatus(true, "Conectando...");
        await setupRealtimeListener();
        startGridTimeUpdates();
    } catch (error) {
        console.error("Erro ao conectar com Firebase:", error);
        updateSyncStatus(false, "Offline - usando armazenamento local");
        document.getElementById('errorPanel').style.display = 'block';
        
        spots = loadSpotsFromLocalStorage();
        renderGrid();
        startPeriodicChecks();
        startGridTimeUpdates();
    }
}

async function setupRealtimeListener() {
    if (unsubscribeSpots) {
        unsubscribeSpots();
    }
    
    if (!currentEstablishment) {
        console.error('Estabelecimento não selecionado');
        return;
    }
    
    const docRef = db.collection("estabelecimentos").doc(currentEstablishment.id);
    
    try {
        unsubscribeSpots = docRef.onSnapshot((doc) => {
            if (doc.exists) {
                const data = doc.data();
                if (data && data.vagasData) {
                    spots = data.vagasData;
                    
                    if (spots.length !== TOTAL_SPOTS) {
                        if (spots.length > TOTAL_SPOTS) {
                            spots = spots.slice(0, TOTAL_SPOTS);
                        } else {
                            spots = spots.concat(Array.from({length: TOTAL_SPOTS - spots.length}, () => null));
                        }
                    }
                    
                    renderGrid();
                    updateSyncStatus(true, "Sincronizado");
                    document.getElementById('errorPanel').style.display = 'none';
                    document.getElementById('loading').style.display = 'none';
                } else {
                    spots = Array.from({length: TOTAL_SPOTS}, () => null);
                    saveSpotsToFirestore();
                }
            }
        }, (error) => {
            console.error("Erro no listener do Firestore:", error);
            
            if (error.code === 'permission-denied') {
                updateSyncStatus(false, "Sem permissão de leitura");
                showError('Sem permissão para ler dados do estabelecimento. Contate o administrador.');
            } else {
                updateSyncStatus(false, "Erro de sincronização");
                showError('Erro de conexão: ' + error.message);
            }
            
            document.getElementById('errorPanel').style.display = 'block';
            
            spots = loadSpotsFromLocalStorage();
            renderGrid();
            document.getElementById('loading').style.display = 'none';
        });
        
        startPeriodicChecks();
        
    } catch (error) {
        console.error("Erro ao configurar listener:", error);
        throw error;
    }
}

async function saveSpotsToFirestore() {
    if (!currentUser || !currentEstablishment) {
        console.error('Usuário ou estabelecimento não autenticado');
        updateSyncStatus(false, "Não autenticado");
        return false;
    }
    
    try {
        await db.collection("estabelecimentos").doc(currentEstablishment.id).update({
            vagasData: spots,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
            lastUpdatedBy: currentUser.email
        });
        updateSyncStatus(true, "Dados salvos");
        document.getElementById('errorPanel').style.display = 'none';
        saveSpotsToLocalStorage();
        return true;
    } catch (error) {
        console.error("Erro ao salvar no Firestore:", error);
        
        if (error.code === 'permission-denied') {
            updateSyncStatus(false, "Sem permissão para salvar");
            showError('Sem permissão para modificar este estabelecimento. Contate o administrador.');
        } else if (error.code === 'unavailable') {
            updateSyncStatus(false, "Sem conexão - usando localStorage");
            showError('Sem conexão com o servidor. Dados salvos localmente.');
        } else {
            updateSyncStatus(false, "Erro ao salvar - usando localStorage");
            showError('Erro ao salvar: ' + error.message);
        }
        
        document.getElementById('errorPanel').style.display = 'block';
        saveSpotsToLocalStorage();
        return false;
    }
}

function updateSyncStatus(online, message) {
    const statusElement = document.getElementById('syncStatus');
    const textElement = document.getElementById('syncText');
    
    if (!statusElement || !textElement) return;
    
    if (online) {
        statusElement.classList.remove('offline');
        statusElement.classList.add('online');
    } else {
        statusElement.classList.remove('online');
        statusElement.classList.add('offline');
    }
    
    textElement.textContent = message;
}

// ======= FUNÇÕES DE ARMAZENAMENTO LOCAL =======
function loadSpotsFromLocalStorage() {
    try {
        if (!currentEstablishment) return Array.from({length: TOTAL_SPOTS}, () => null);
        
        const key = `estacionamento_${currentEstablishment.id}_spots`;
        const saved = JSON.parse(localStorage.getItem(key)) || [];
        if (saved.length === TOTAL_SPOTS) return saved;
        
        return Array.from({length: TOTAL_SPOTS}, (_, i) => saved[i] || null);
    } catch(e) {
        console.warn('Erro ao carregar do localStorage:', e);
        return Array.from({length: TOTAL_SPOTS}, () => null);
    }
}

function saveSpotsToLocalStorage() {
    if (!currentEstablishment) return;
    
    try {
        const key = `estacionamento_${currentEstablishment.id}_spots`;
        localStorage.setItem(key, JSON.stringify(spots));
    } catch(e) {
        console.warn('Erro ao salvar no localStorage:', e);
    }
}

// ======= RENDERIZAÇÃO DO GRID =======
function renderGrid() {
    const grid = document.getElementById('grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    for(let i = 0; i < TOTAL_SPOTS; i++) {
        const div = document.createElement('div');
        const spot = spots[i];
        div.className = 'slot ' + (spot ? (spot.paid ? 'paid' : 'occupied') : 'free');
        div.dataset.index = i;
        
        let metaContent = '';
        if (spot) {
            if (spot.plate) metaContent += `<div class="meta"><strong> Placa: ${spot.plate}</strong></div>`;
            if (spot.name) metaContent += `<div class="meta"> Nome: ${spot.name}</div>`;
            if (spot.vehicleName) metaContent += `<div class="meta"> Veículo: ${spot.vehicleName}</div>`;
            if (spot.color) metaContent += `<div class="meta"> Cor: ${spot.color}</div>`;
            if (spot.entryTime) {
                const entryTime = new Date(spot.entryTime);
                const formattedEntryTime = entryTime.toLocaleTimeString('pt-BR', { 
                    hour: '2-digit', 
                    minute: '2-digit'
                });
                
                const now = new Date();
                const diffMinutes = Math.round((now - entryTime) / (1000 * 60));
                const diffHours = Math.floor(diffMinutes / 60);
                const remainingMinutes = diffMinutes % 60;
                
                let timeDisplay = `Entrada: ${formattedEntryTime}`;
                
                if (!spot.paid) {
                    if (diffHours > 0) {
                        timeDisplay += `<br><small>${diffHours}h ${remainingMinutes}m</small>`;
                    } else {
                        timeDisplay += `<br><small>${diffMinutes}m</small>`;
                    }
                }
                
                metaContent += `<div class="meta entry-time">${timeDisplay}</div>`;
            }
            
            if (spot.paid) {
                if (spot.paidExpiresAt) {
                    const expiresAt = new Date(spot.paidExpiresAt);
                    const now = new Date();
                    const remainingMinutes = Math.round((expiresAt - now) / (1000 * 60));
                    
                    if (remainingMinutes > 0) {
                        metaContent += `<div class="paid-status">PAGO (${remainingMinutes}m)</div>`;
                    } else {
                        metaContent += `<div class="paid-status">PAGO</div>`;
                    }
                } else {
                    metaContent += `<div class="paid-status">PAGO</div>`;
                }
            }
            
            const vehicleIcon = spot.vehicleType === 'carro' ? '🚗' : '🏍️';
            metaContent += `<div class="meta" style="font-size: 1.2rem;">${vehicleIcon}</div>`;
            
        } else {
            metaContent = `<div class="meta" style="font-size: 2rem; opacity: 0.7;">🆓</div>`;
        }
        
        div.innerHTML = `<div class="num">Vaga ${i+1}</div>` + metaContent;
        div.addEventListener('click', () => openModal(i));
        grid.appendChild(div);
    }
    
    const loadingElement = document.getElementById('loading');
    if (loadingElement) {
        loadingElement.style.display = 'none';
    }
}

// ======= ATUALIZAÇÃO DE TEMPOS EM TEMPO REAL =======
function startGridTimeUpdates() {
    setInterval(() => {
        if (document.getElementById('mainSystem') && document.getElementById('mainSystem').style.display !== 'none') {
            updateGridTimes();
        }
    }, 60000);
}

function updateGridTimes() {
    const grid = document.getElementById('grid');
    if (!grid) return;
    
    const slots = grid.getElementsByClassName('slot');
    
    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const index = parseInt(slot.dataset.index);
        const spot = spots[index];
        
        if (spot && !spot.paid) {
            const entryTime = new Date(spot.entryTime);
            const now = new Date();
            const diffMinutes = Math.round((now - entryTime) / (1000 * 60));
            const diffHours = Math.floor(diffMinutes / 60);
            const remainingMinutes = diffMinutes % 60;
            
            const timeElements = slot.getElementsByClassName('entry-time');
            if (timeElements.length > 0) {
                const formattedEntryTime = entryTime.toLocaleTimeString('pt-BR', { 
                    hour: '2-digit', 
                    minute: '2-digit'
                });
                
                let timeDisplay = `Entrada: ${formattedEntryTime}`;
                if (diffHours > 0) {
                    timeDisplay += `<br><small>${diffHours}h ${remainingMinutes}m</small>`;
                } else {
                    timeDisplay += `<br><small>${diffMinutes}m</small>`;
                }
                
                timeElements[0].innerHTML = timeDisplay;
            }
        }
        
        if (spot && spot.paid && spot.paidExpiresAt) {
            const expiresAt = new Date(spot.paidExpiresAt);
            const now = new Date();
            const remainingMinutes = Math.max(0, Math.round((expiresAt - now) / (1000 * 60)));
            
            const paidElements = slot.getElementsByClassName('paid-status');
            if (paidElements.length > 0) {
                if (remainingMinutes > 0) {
                    paidElements[0].textContent = `PAGO (${remainingMinutes}m)`;
                } else {
                    paidElements[0].textContent = 'PAGO';
                }
            }
        }
    }
}

// ======= CONFIGURAÇÃO DO MODAL =======
function configurarModalParaEstabelecimento() {
    const rates = currentEstablishment?.tarifas;
    const radioGroup = document.querySelector('.radio-group:first-of-type');
    
    if (radioGroup) {
        if (rates && rates.carro && rates.carro.first !== undefined) {
            radioGroup.style.display = 'none';
            document.getElementById('clientComerciario').checked = true;
        } else {
            radioGroup.style.display = 'flex';
        }
    }
    
}


    
    const vehicleType = getRadio('vehicleType');
    const clientType = getRadio('clientType');
    
    const rates = currentEstablishment?.tarifas;
    let displayText = '';
    
    if (rates && rates[vehicleType]) {
        if (rates[vehicleType].first !== undefined) {
            displayText = `${vehicleType === 'carro' ? 'Carro' : 'Moto'} (Tarifa Única)`;
        } else {
            displayText = `${vehicleType === 'carro' ? 'Carro' : 'Moto'} ${clientType === 'comerciario' ? '(Comerciário)' : '(Usuário)'}`;
        }
    } else {
        displayText = `${vehicleType === 'carro' ? 'Carro' : 'Moto'} ${clientType === 'comerciario' ? '(Comerciário)' : '(Usuário)'}`;
    }
    

// ======= FUNÇÕES DO MODAL =======
const overlay = document.getElementById('overlay');
const nameInput = document.getElementById('name');
const vehicleNameInput = document.getElementById('vehicleName');
const plateInput = document.getElementById('plate');
const colorInput = document.getElementById('color');
const entryInput = document.getElementById('entryTime');
const exitInput = document.getElementById('exitTime');
const calcResult = document.getElementById('calcResult');
const ticketPreview = document.getElementById('ticketPreview');
const timeInfo = document.getElementById('timeInfo');


function openModal(index) {
    currentIndex = index;
    const data = spots[index];
    document.getElementById('modalTitle').innerText = `Vaga ${index+1}`;
    
    configurarModalParaEstabelecimento();
    
    if(!data) {
        nameInput.value = '';
        vehicleNameInput.value = '';
        plateInput.value = '';
        colorInput.value = '';
        entryInput.value = formatForDatetimeLocal(new Date());
        exitInput.value = '';
        document.getElementById('clientComerciario').checked = true;
        document.getElementById('vehicleCar').checked = true;
        calcResult.innerText = '';
        ticketPreview.style.display = 'none';
        timeInfo.innerText = 'Tempo decorrido: 0 minutos';
        
     
    } else {
        nameInput.value = data.name || '';
        vehicleNameInput.value = data.vehicleName || '';
        plateInput.value = data.plate || '';
        colorInput.value = data.color || '';
        entryInput.value = formatForDatetimeLocal(new Date(data.entryTime));
        exitInput.value = data.exitTime ? formatForDatetimeLocal(new Date(data.exitTime)) : '';
        
        if (data.clientType === 'usuario') {
            document.getElementById('clientUsuario').checked = true;
        } else {
            document.getElementById('clientComerciario').checked = true;
        }
        
        if (data.vehicleType === 'moto') {
            document.getElementById('vehicleMoto').checked = true;
        } else {
            document.getElementById('vehicleCar').checked = true;
        }
        
        calcResult.innerText = data.lastCalculated ? `R$ ${data.lastCalculated.price.toFixed(2)}` : '';
        

        
        updateTimeInfo(data);
        
        if(data.ticketHtml) {
            ticketPreview.style.display = 'block';
            ticketPreview.innerHTML = data.ticketHtml;
        } else {
            ticketPreview.style.display = 'none';
        }
    }
    overlay.classList.add('show');
}

function updateTimeInfo(data) {
    if (!timeInfo) return;
    
    const entry = new Date(data.entryTime);
    const now = new Date();
    const diffMs = now - entry;

    // Calcula o tempo total em minutos
    const totalMinutes = Math.floor(diffMs / (1000 * 60));

    // Separa em horas e minutos
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    let timeText = `Tempo decorrido: ${hours} hora${hours !== 1 ? 's' : ''} e ${minutes} minuto${minutes !== 1 ? 's' : ''}`;

    // Verifica tolerância em minutos
    if (totalMinutes <= TOLERANCE_MIN && !data.paid) {
        timeText += ` (Dentro da tolerância de ${TOLERANCE_MIN}min)`;
        timeInfo.style.color = '#2ecc71';
    } else {
        timeInfo.style.color = 'inherit';
    }

    timeInfo.innerText = timeText;
}

function closeModal() {
    overlay.classList.remove('show');
}

// ======= CÁLCULO DE TARIFA =======
function calculateTariff(entry, exit, vehicleType, clientType) {
    if (!entry || !exit) return null;
    
    const minutes = minutesBetween(entry, exit);
    
    if (minutes <= TOLERANCE_MIN) {
        return {minutes, type: 'tolerancia', price: 0, breakdown: `Dentro da tolerância de ${TOLERANCE_MIN}min: Isento`};
    }
    
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    
    let vehicleRates;
    try {
        const rates = currentEstablishment?.tarifas;
        
        if (rates && rates[vehicleType]) {
            if (rates[vehicleType].first !== undefined) {
                vehicleRates = rates[vehicleType];
            } else if (rates[vehicleType][clientType]) {
                vehicleRates = rates[vehicleType][clientType];
            } else {
                throw new Error('Estrutura de tarifas inválida');
            }
        } else {
            throw new Error('Tarifas não configuradas');
        }
    } catch (error) {
        console.warn('Usando tarifas padrão:', error.message);
        vehicleRates = DEFAULT_RATES[vehicleType][clientType];
    }
    
    if (minutes >= DIARY_THRESHOLD_HOURS * 60) {
        const daily = vehicleRates.daily;
        return {
            minutes, 
            type: 'diaria', 
            price: daily, 
            breakdown: `Diária aplicada (>= ${DIARY_THRESHOLD_HOURS}h): R$ ${daily.toFixed(2)}`
        };
    }
    
    let chargedHours = Math.max(1, hours + (remainder > TOLERANCE_MIN ? 1 : 0));
    const first = vehicleRates.first;
    const additional = vehicleRates.additional;
    let price = chargedHours === 1 ? first : first + additional * (chargedHours - 1);
    
    const breakdown = `Tempo: ${Math.floor(minutes/60)}h ${minutes%60}m → Cobrado: ${chargedHours}h (tolerância ${TOLERANCE_MIN}m). Valor: R$ ${price.toFixed(2)}`;
    
    return {minutes, chargedHours, price, breakdown};
}

// ======= BOTÕES DO MODAL =======
document.getElementById('btnClose').addEventListener('click', () => {
    closeModal();
});

document.getElementById('btnOccupy').addEventListener('click', async () => {
    const button = document.getElementById('btnOccupy');
    setLoading(button, true, 'Salvando...');
    
    try {
        const name = nameInput.value.trim();
        const vehicleName = vehicleNameInput.value.trim();
        const plate = plateInput.value.trim().toUpperCase();
        const color = colorInput.value.trim();
        const entry = parseDatetimeLocal(entryInput.value) || new Date();
        const exit = parseDatetimeLocal(exitInput.value);
        const clientType = getRadio('clientType') || 'comerciario';
        const vehicleType = getRadio('vehicleType') || 'carro';

        if (plate && !validatePlate(plate)) {
            alert('Placa inválida! Use o formato: AAA-0A00 ou AAA0A00');
            return;
        }
        
        const data = {
            name, 
            vehicleName,
            plate, 
            color, 
            entryTime: entry.toISOString(), 
            exitTime: exit ? exit.toISOString() : null,
            clientType, 
            vehicleType, 
            paid: false, 
            paidAt: null, 
            lastCalculated: null, 
            ticketHtml: null
        };
        
        spots[currentIndex] = data;
        const saved = await saveSpotsToFirestore();
        renderGrid();

        if (saved) {
            const ticketHtml = buildTicketHtml(currentIndex + 1, data, null);
            spots[currentIndex].ticketHtml = ticketHtml;
            await saveSpotsToFirestore();
            ticketPreview.style.display = 'block';
            ticketPreview.innerHTML = ticketHtml;

            openPrintWindow(ticketHtml);
            closeModal();
        }
    } catch (error) {
        console.error('Erro ao ocupar vaga:', error);
        alert('Erro ao salvar: ' + error.message);
    } finally {
        setLoading(button, false);
    }
});

document.getElementById('setExitNow').addEventListener('click', () => {
    exitInput.value = formatForDatetimeLocal(new Date());
    
    if (spots[currentIndex]) {
        updateTimeInfo(spots[currentIndex]);
    }
});

document.getElementById('calcTariff').addEventListener('click', () => {
    const entry = parseDatetimeLocal(entryInput.value) || null;
    const exit = parseDatetimeLocal(exitInput.value) || new Date();
    const clientType = getRadio('clientType') || 'comerciario';
    const vehicleType = getRadio('vehicleType') || 'carro';
    
    if (!entry) {
        alert('Entrada inválida'); 
        return;
    }
    
    const res = calculateTariff(entry, exit, vehicleType, clientType);
    if (!res) {
        alert('Não foi possível calcular'); 
        return;
    }
    
    calcResult.innerText = `R$ ${res.price.toFixed(2)}`;
    
    const hours = Math.floor(res.minutes / 60);
    const minutes = res.minutes % 60;
    
    const previewHtml = `<div><strong>Vaga ${currentIndex + 1}</strong></div>
        <div>${nameInput.value || ''} - ${vehicleNameInput.value || ''}</div>
        <div>Placa: ${plateInput.value || ''}</div>
        <div>Entrada: ${entry.toLocaleString()}</div>
        <div>Saída: ${exit.toLocaleString()}</div>
        <div>Tempo: ${hours}h ${minutes}m</div>
        <div style="margin-top:6px;font-weight:700">Valor: R$ ${res.price.toFixed(2)}</div>`;
    
    ticketPreview.style.display = 'block';
    ticketPreview.innerHTML = previewHtml;
    
    ticketPreview.title = res.breakdown || '';
});

document.getElementById('btnPago').addEventListener('click', async () => {
    const button = document.getElementById('btnPago');
    setLoading(button, true, 'Processando...');
    
    try {
        const spot = spots[currentIndex];
        if (!spot) {
            alert('Vaga sem ocupação. Use Salvar para ocupar.'); 
            return;
        }
        
        const entry = new Date(spot.entryTime);
        const exit = parseDatetimeLocal(exitInput.value) || new Date();
        
        if (exit < entry) {
            alert('Saída anterior à entrada'); 
            return;
        }
        
        const res = calculateTariff(entry, exit, spot.vehicleType, spot.clientType);
        if (!res) {
            alert('Erro no cálculo'); 
            return;
        }
        
        spot.lastCalculated = res;
        spot.exitTime = exit.toISOString();
        spot.paid = true;
        spot.paidAt = new Date().toISOString();
        spot.paidExpiresAt = new Date(Date.now() + PAID_GRACE_MIN * 60000).toISOString();
        spot.ticketHtml = buildTicketHtml(currentIndex + 1, spot, res);
        
        const saved = await saveSpotsToFirestore();
        if (saved) {
            renderGrid();
            openPrintWindow(spot.ticketHtml);
            closeModal();
        }
    } catch (error) {
        console.error('Erro ao processar pagamento:', error);
        alert('Erro ao processar pagamento: ' + error.message);
    } finally {
        setLoading(button, false);
    }
});

document.getElementById('btnRelease').addEventListener('click', async () => {
    if (!confirm('Confirma liberar esta vaga? Todos os dados serão removidos.')) return;
    
    const button = document.getElementById('btnRelease');
    setLoading(button, true, 'Liberando...');
    
    try {
        spots[currentIndex] = null;
        const saved = await saveSpotsToFirestore();
        if (saved) {
            renderGrid();
            closeModal();
        }
    } catch (error) {
        console.error('Erro ao liberar vaga:', error);
        alert('Erro ao liberar vaga: ' + error.message);
    } finally {
        setLoading(button, false);
    }
});

// ======= CONFIGURAÇÃO DE VAGAS =======
document.getElementById('applySpots').addEventListener('click', async () => {
    const button = document.getElementById('applySpots');
    setLoading(button, true, 'Aplicando...');
    
    try {
        const n = parseInt(document.getElementById('numSpots').value, 10) || 20;
        TOTAL_SPOTS = n;
        
        if (spots.length > n) {
            spots = spots.slice(0, n);
        } else {
            spots = spots.concat(Array.from({length: n - spots.length}, () => null));
        }
        
        if (currentEstablishment) {
            await db.collection("estabelecimentos").doc(currentEstablishment.id).update({
                vagas: TOTAL_SPOTS
            });
        }
        
        await saveSpotsToFirestore();
        renderGrid();
    } catch (error) {
        console.error('Erro ao aplicar configuração:', error);
        alert('Erro ao aplicar configuração: ' + error.message);
    } finally {
        setLoading(button, false);
    }
});

document.getElementById('clearAll').addEventListener('click', async () => {
    if (!confirm('Limpar todos os dados de vagas (isso não pode ser desfeito)?')) return;
    
    const button = document.getElementById('clearAll');
    setLoading(button, true, 'Limpando...');
    
    try {
        spots = Array.from({length: TOTAL_SPOTS}, () => null);
        await saveSpotsToFirestore();
        renderGrid();
    } catch (error) {
        console.error('Erro ao limpar vagas:', error);
        alert('Erro ao limpar vagas: ' + error.message);
    } finally {
        setLoading(button, false);
    }
});

// ======= TICKET E IMPRESSÃO =======
function buildTicketHtml(vagaNumber, data, calc) {
    const entry = data.entryTime ? new Date(data.entryTime).toLocaleString() : '-';
    const exit = data.exitTime ? new Date(data.exitTime).toLocaleString() : '-';
    
    let timeText = '';
    if (data.entryTime) {
        const entryTime = new Date(data.entryTime);
        const exitTime = data.exitTime ? new Date(data.exitTime) : new Date();
        const minutes = minutesBetween(entryTime, exitTime);
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        timeText = `${hours}h ${mins}m`;
    }
    
    const valor = (calc && calc.price) ? `R$ ${calc.price.toFixed(2)}` : (data.lastCalculated ? `R$ ${data.lastCalculated.price.toFixed(2)}` : '---');
    const paidText = data.paid ? 'PAGO' : 'NÃO PAGO';
    
    return `<div style="font-family:Arial,Helvetica,sans-serif;width:300px;padding:15px;font-size:16px;line-height:1.4">
        <div style="text-align:center;font-weight:800;font-size:20px;margin-bottom:12px;border-bottom:2px solid #000;padding-bottom:8px">VAGA ${vagaNumber}</div>
        <div style="margin-bottom:8px"><strong>Nome:</strong> ${escapeHtml(data.name || '')}</div>
        <div style="margin-bottom:8px"><strong>Veículo:</strong> ${escapeHtml(data.vehicleName || '')} (${escapeHtml(data.vehicleType || '')})</div>
        <div style="margin-bottom:8px"><strong>Placa:</strong> ${escapeHtml(data.plate || '')}</div>
        <div style="margin-bottom:8px"><strong>Cor:</strong> ${escapeHtml(data.color || '')}</div>
        <div style="margin-bottom:8px"><strong>Entrada:</strong> ${escapeHtml(entry)}</div>
        <div style="margin-bottom:8px"><strong>Saída:</strong> ${escapeHtml(exit)}</div>
        <div style="margin-bottom:8px"><strong>Tempo total:</strong> ${escapeHtml(timeText)}</div>
        <div style="margin-bottom:8px;font-size:18px;font-weight:700;border-top:1px dashed #000;padding-top:8px">Valor: ${escapeHtml(valor)}</div>
        <div style="font-size:14px;margin-top:6px;text-align:center">Status: ${escapeHtml(paidText)}</div>
    </div>`;
}

function openPrintWindow(html) {
    const w = window.open('', '_blank', 'width=400,height=500');
    if (w) {
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Ticket</title><style>
            body{font-family:Arial;margin:0;padding:10px;display:flex;flex-direction:column;justify-content:center;align-items:center;min-height:100vh;background:#f0f0f0}
            .print-button{display:block;margin-top:15px;text-align:center}
            @media print{body{background:#fff;height:auto} .print-button{display:none} @page{size:auto;margin:0}}
        </style></head><body>
            ${html}
            <div class="print-button"><button onclick="window.print();" style="padding:8px 16px;background:#2b7cff;color:#fff;border:none;border-radius:4px;cursor:pointer">Imprimir</button></div>
        </body></html>`);
        w.document.close();
    } else {
        alert('Não foi possível abrir a janela de impressão. Verifique se o pop-up está bloqueado.');
    }
}

// ======= PERIODIC CHECKS =======
function startPeriodicChecks() {
    if (checkInterval) clearInterval(checkInterval);
    
    checkInterval = setInterval(() => {
        const now = new Date();
        let changed = false;
        
        for (let i = 0; i < spots.length; i++) {
            const s = spots[i];
            if (!s) continue;
            
            if (s.paid && s.paidExpiresAt) {
                const exp = new Date(s.paidExpiresAt);
                if (now > exp) {
                    s.paid = false;
                    s.paidAt = null;
                    s.paidExpiresAt = null;
                    changed = true;
                }
            }
        }
        
        if (changed) {
            saveSpotsToFirestore();
            renderGrid();
        }
    }, 1000 * 30);
}

// ======= EVENT LISTENERS ADICIONAIS =======
if (overlay) {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') e.preventDefault();
    });
}

window.addEventListener('beforeunload', () => {
    saveSpotsToLocalStorage();
});

setInterval(() => {
    if (overlay && overlay.classList.contains('show') && currentIndex !== null && spots[currentIndex]) {
        updateTimeInfo(spots[currentIndex]);
    }
}, 60000);



document.querySelectorAll('input[name="vehicleType"], input[name="clientType"]').forEach(input => {
    input.addEventListener('change', () => {
        
        
        if (spots[currentIndex]) {
            const entry = parseDatetimeLocal(entryInput.value);
            const exit = parseDatetimeLocal(exitInput.value) || new Date();
            if (entry) {
                const calcResult = calculateTariff(entry, exit, getRadio('vehicleType'), getRadio('clientType'));
                if (calcResult && document.getElementById('calcResult')) {
                    document.getElementById('calcResult').innerText = `R$ ${calcResult.price.toFixed(2)}`;
                }
            }
        }
    });
});

// ======= EVENT LISTENERS PRINCIPAIS =======
document.addEventListener('DOMContentLoaded', function() {
    console.log('Sistema Multi-Estabelecimento - Inicializando...');
    initAuth();
});

// Login
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const loginBtn = document.getElementById('btnLogin');
    const errorDiv = document.getElementById('loginError');
    
    setLoading(loginBtn, true, 'Entrando...');
    errorDiv.style.display = 'none';
    
    try {
        await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        console.error('Erro no login:', error);
        errorDiv.style.display = 'block';
        
        switch (error.code) {
            case 'auth/invalid-email': errorDiv.textContent = 'E-mail inválido.'; break;
            case 'auth/user-disabled': errorDiv.textContent = 'Esta conta foi desativada.'; break;
            case 'auth/user-not-found': errorDiv.textContent = 'Usuário não encontrado.'; break;
            case 'auth/wrong-password': errorDiv.textContent = 'Senha incorreta.'; break;
            default: errorDiv.textContent = 'Erro ao fazer login. Tente novamente.';
        }
    } finally {
        setLoading(loginBtn, false);
    }
});

// Logout
document.getElementById('btnLogout').addEventListener('click', async () => {
    if (confirm('Deseja realmente sair do sistema?')) {
        try {
            await auth.signOut();
        } catch (error) {
            console.error('Erro ao fazer logout:', error);
            alert('Erro ao sair do sistema.');
        }
    }
});

document.getElementById('btnLogoutEstablishment').addEventListener('click', async () => {
    if (confirm('Deseja realmente sair da conta?')) {
        try {
            await auth.signOut();
        } catch (error) {
            console.error('Erro ao fazer logout:', error);
            alert('Erro ao sair da conta.');
        }
    }
});

// Estabelecimentos
document.getElementById('btnSelectEstablishment').addEventListener('click', selectEstablishment);
document.getElementById('btnSwitchEstablishment').addEventListener('click', switchEstablishment);

// Recuperação de senha
document.getElementById('forgotPassword').addEventListener('click', (e) => {
    e.preventDefault();
    const email = prompt('Digite seu e-mail para redefinir a senha:');
    if (email) {
        resetPassword(email);
    }
});

async function resetPassword(email) {
    try {
        await auth.sendPasswordResetEmail(email);
        alert('E-mail de redefinição de senha enviado! Verifique sua caixa de entrada.');
    } catch (error) {
        console.error('Erro ao enviar e-mail de redefinição:', error);
        alert('Erro ao enviar e-mail de redefinição. Verifique o e-mail digitado.');
    }
}

console.log('Sistema carregado. Sistema Multi-Estabelecimento com tarifas configuráveis.');