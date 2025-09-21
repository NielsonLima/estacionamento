 // ======= Configurações e tarifas =======
    const RATES = {
      carro: {
        comerciario: {first:2, additional:2, daily:15},
        usuario: {first:4, additional:3, daily:25}
      },
      moto: {
        comerciario: {first:2, additional:1, daily:10},
        usuario: {first:3, additional:2, daily:15}
      }
    };
    const TOLERANCE_MIN = 15; // minutos de tolerância na entrada
    const DIARY_THRESHOLD_HOURS = 9; // horas para tarifar como diarista
    const PAID_GRACE_MIN = 15; // após pagar, tem 15 minutos de graça para sair (fica verde)

    // ======= Estado =======
    let TOTAL_SPOTS = parseInt(document.getElementById('numSpots').value,10) || 20;
    let spots = Array.from({length:TOTAL_SPOTS},()=>null);
    let currentIndex = null; // vaga aberta no modal
    let checkInterval = null;
    let unsubscribeSpots = null; // Função para parar de ouvir atualizações

    // ======= Inicialização =======
    initApp();

    // ======= Funções do Firebase =======
    async function initApp() {
      try {
        updateSyncStatus(true, "Conectando...");
        
        // Configura o listener em tempo real para as vagas
        setupRealtimeListener();
      } catch (error) {
        console.error("Erro ao conectar com Firebase:", error);
        updateSyncStatus(false, "Offline - usando armazenamento local");
        
        // Carrega do localStorage como fallback
        spots = loadSpotsFromLocalStorage(TOTAL_SPOTS);
        renderGrid();
        startPeriodicChecks();
      }
    }

    function setupRealtimeListener() {
      if (unsubscribeSpots) {
        unsubscribeSpots(); // Remove listener anterior se existir
      }
      
      const docRef = doc(db, "parking", "spots");
      
      unsubscribeSpots = onSnapshot(docRef, (doc) => {
        if (doc.exists()) {
          const data = doc.data();
          if (data && data.spots) {
            spots = data.spots;
            
            // Ajusta o tamanho do array se necessário
            if (spots.length !== TOTAL_SPOTS) {
              if (spots.length > TOTAL_SPOTS) {
                spots = spots.slice(0, TOTAL_SPOTS);
              } else {
                spots = spots.concat(Array.from({length: TOTAL_SPOTS - spots.length}, () => null));
              }
            }
            
            renderGrid();
            updateSyncStatus(true, "Sincronizado");
          }
        } else {
          // Se o documento não existe, cria com valores padrão
          saveSpotsToFirestore();
        }
      }, (error) => {
        console.error("Erro no listener do Firestore:", error);
        updateSyncStatus(false, "Erro de sincronização");
        
        // Fallback para localStorage
        spots = loadSpotsFromLocalStorage(TOTAL_SPOTS);
        renderGrid();
      });
      
      startPeriodicChecks();
    }

    async function saveSpotsToFirestore() {
      try {
        const docRef = doc(db, "parking", "spots");
        await setDoc(docRef, {
          spots: spots,
          lastUpdated: new Date()
        });
        updateSyncStatus(true, "Dados salvos");
        
        // Também salva no localStorage como backup
        saveSpotsToLocalStorage();
      } catch (error) {
        console.error("Erro ao salvar no Firestore:", error);
        updateSyncStatus(false, "Erro ao salvar - usando localStorage");
        
        // Fallback para localStorage
        saveSpotsToLocalStorage();
      }
    }

    function updateSyncStatus(online, message) {
      const statusElement = document.getElementById('syncStatus');
      const textElement = document.getElementById('syncText');
      
      if (online) {
        statusElement.classList.remove('offline');
        statusElement.classList.add('online');
      } else {
        statusElement.classList.remove('online');
        statusElement.classList.add('offline');
      }
      
      textElement.textContent = message;
    }

    // ======= Load / Save (Local Storage como fallback) =======
    function loadSpotsFromLocalStorage(n) {
      try {
        const saved = JSON.parse(localStorage.getItem('estacionamento_spots')) || [];
        if (saved.length === n) return saved;
        
        // Se o tamanho for diferente, ajusta o array
        const arr = Array.from({length: n}, (_, i) => saved[i] || null);
        return arr;
      } catch(e) {
        return Array.from({length: n}, () => null);
      }
    }

    function saveSpotsToLocalStorage() {
      localStorage.setItem('estacionamento_spots', JSON.stringify(spots));
    }

    // ======= Grid =======
    function renderGrid() {
      const grid = document.getElementById('grid');
      grid.innerHTML = '';
      
      for(let i = 0; i < TOTAL_SPOTS; i++) {
        const div = document.createElement('div');
        div.className = 'slot ' + (spots[i] ? (spots[i].paid ? 'paid' : 'occupied') : 'free');
        div.dataset.index = i;
        div.innerHTML = `<div class="num">Vaga ${i+1}</div>` + 
                        (spots[i] ? `<div class="meta">${spots[i].plate || ''}</div><div class="meta">${spots[i].name || ''}</div>` : '');
        div.addEventListener('click', () => openModal(i));
        grid.appendChild(div);
      }
    }

    // ======= Modal =======
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
    const ownerNameDisplay = document.getElementById('ownerNameDisplay');
    const vehicleTypeDisplay = document.getElementById('vehicleTypeDisplay');

    function openModal(index) {
      currentIndex = index;
      const data = spots[index];
      document.getElementById('modalTitle').innerText = `Vaga ${index+1}`;
      
      if(!data) {
        // nova ocupação
        nameInput.value = '';
        vehicleNameInput.value = '';
        plateInput.value = '';
        colorInput.value = '';
        entryInput.value = formatForDatetimeLocal(new Date());
        exitInput.value = '';
        setRadio('clientType', 'comerciario');
        setRadio('vehicleType', 'carro');
        calcResult.innerText = '';
        ticketPreview.style.display = 'none';
        timeInfo.innerText = 'Tempo decorrido: 0 minutos';
        
        // Atualizar displays
        ownerNameDisplay.textContent = '-';
        vehicleTypeDisplay.textContent = '-';
      } else {
        // mostrar dados existentes
        nameInput.value = data.name || '';
        vehicleNameInput.value = data.vehicleName || '';
        plateInput.value = data.plate || '';
        colorInput.value = data.color || '';
        entryInput.value = formatForDatetimeLocal(new Date(data.entryTime));
        exitInput.value = data.exitTime ? formatForDatetimeLocal(new Date(data.exitTime)) : '';
        setRadio('clientType', data.clientType || 'comerciario');
        setRadio('vehicleType', data.vehicleType || 'carro');
        calcResult.innerText = data.lastCalculated ? `R$ ${data.lastCalculated.price.toFixed(2)}` : '';
        
        // Atualizar displays
        ownerNameDisplay.textContent = data.name || '-';
        vehicleTypeDisplay.textContent = (data.vehicleType === 'carro' ? 'Carro' : 'Moto') + 
                                        (data.clientType === 'comerciario' ? ' (Comerciário)' : ' (Usuário)');
        
        // Calcular e mostrar tempo decorrido
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
      const entry = new Date(data.entryTime);
      const now = new Date();
      const diffMs = now - entry;
      const diffMins = Math.round(diffMs / 60000);
      
      let timeText = `Tempo decorrido: ${diffMins} minutos`;
      
      // Verificar se está dentro do período de tolerância
      if (diffMins <= TOLERANCE_MIN && !data.paid) {
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

    // ======= Helpers =======
    function getRadio(name) {
      const el = document.querySelector(`input[name="${name}"]:checked`);
      return el ? el.value : null;
    }

    function setRadio(name, val) {
      const el = document.querySelector(`input[name="${name}"][value="${val}"]`);
      if (el) el.checked = true;
    }

    function formatForDatetimeLocal(date) {
      const dt = new Date(date);
      // local ISO slice
      const off = dt.getTimezoneOffset();
      const local = new Date(dt.getTime() - off * 60000);
      return local.toISOString().slice(0, 16);
    }

    function parseDatetimeLocal(v) {
      if (!v) return null;
      // input is local datetime like "2025-09-21T11:45"
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }

    function minutesBetween(a, b) {
      return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
    }

    // ======= Cálculo de tarifa =======
    function calculateTariff(entry, exit, vehicleType, clientType) {
      if (!entry || !exit) return null;
      
      const minutes = minutesBetween(entry, exit);
      
      // Aplicar tolerância de 15 minutos na entrada
      if (minutes <= TOLERANCE_MIN) {
        return {minutes, type: 'tolerancia', price: 0, breakdown: `Dentro da tolerância de ${TOLERANCE_MIN}min: Isento`};
      }
      
      const hours = Math.floor(minutes / 60);
      const remainder = minutes % 60;
      
      // diária?
      if (minutes >= DIARY_THRESHOLD_HOURS * 60) {
        const daily = RATES[vehicleType][clientType].daily;
        return {minutes, type: 'diaria', price: daily, breakdown: `Diária aplicada (>= ${DIARY_THRESHOLD_HOURS}h): R$ ${daily.toFixed(2)}`};
      }
      
      // calcular horas cobradas com tolerância de 15min
      let chargedHours = Math.max(1, hours + (remainder > TOLERANCE_MIN ? 1 : 0));
      const first = RATES[vehicleType][clientType].first;
      const additional = RATES[vehicleType][clientType].additional;
      let price = 0;
      
      if (chargedHours === 1) price = first;
      else price = first + additional * (chargedHours - 1);
      
      const breakdown = `Tempo: ${Math.floor(minutes/60)}h ${minutes%60}m → Cobrado: ${chargedHours}h (tolerância ${TOLERANCE_MIN}m). Valor: R$ ${price.toFixed(2)}`;
      return {minutes, chargedHours, price, breakdown};
    }

    // ======= Botões do modal =======
    document.getElementById('btnClose').addEventListener('click', () => {
      closeModal();
    });

    document.getElementById('btnOccupy').addEventListener('click', () => {
      // salvar/ocupar
      const name = nameInput.value.trim();
      const vehicleName = vehicleNameInput.value.trim();
      const plate = plateInput.value.trim();
      const color = colorInput.value.trim();
      const entry = parseDatetimeLocal(entryInput.value) || new Date();
      const exit = parseDatetimeLocal(exitInput.value);
      const clientType = getRadio('clientType') || 'comerciario';
      const vehicleType = getRadio('vehicleType') || 'carro';

      // if spot already occupied, just update data
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
      saveSpotsToFirestore();
      renderGrid();

      // gerar ticket de entrada
      const ticketHtml = buildTicketHtml(currentIndex + 1, data, null);
      spots[currentIndex].ticketHtml = ticketHtml;
      saveSpotsToFirestore();
      ticketPreview.style.display = 'block';
      ticketPreview.innerHTML = ticketHtml;

      // abrir janela de impressão para ticket de entrada
      openPrintWindow(ticketHtml);

      closeModal();
    });

    // marcar saída agora
    document.getElementById('setExitNow').addEventListener('click', () => {
      exitInput.value = formatForDatetimeLocal(new Date());
      
      // Recalcular tempo decorrido
      if (spots[currentIndex]) {
        updateTimeInfo(spots[currentIndex]);
      }
    });

    // calcular tarifa
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
      
      // armazenar cálculo temporariamente no preview
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
      
      // show breakdown in tooltip
      ticketPreview.title = res.breakdown || '';
    });

    // Pago
    document.getElementById('btnPago').addEventListener('click', () => {
      const spot = spots[currentIndex];
      if (!spot) {
        alert('Vaga sem ocupação. Use Salvar para ocupar.'); 
        return;
      }
      
      // ensure exit is set
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
      
      saveSpotsToFirestore();
      renderGrid();
      openPrintWindow(spot.ticketHtml);
      closeModal();
    });

    // Liberar vaga
    document.getElementById('btnRelease').addEventListener('click', () => {
      if (!confirm('Confirma liberar esta vaga? Todos os dados serão removidos.')) return;
      
      // Remove completamente os dados da vaga
      spots[currentIndex] = null;
      saveSpotsToFirestore();
      renderGrid();
      
      // Fecha o modal após liberar a vaga
      closeModal();
    });

    // aplicar quantidade de vagas
    document.getElementById('applySpots').addEventListener('click', () => {
      const n = parseInt(document.getElementById('numSpots').value, 10) || 20;
      TOTAL_SPOTS = n;
      
      // Ajusta o array de vagas para o novo tamanho
      if (spots.length > n) {
        spots = spots.slice(0, n);
      } else {
        spots = spots.concat(Array.from({length: n - spots.length}, () => null));
      }
      
      saveSpotsToFirestore();
      renderGrid();
    });

    // limpar todos os dados
    document.getElementById('clearAll').addEventListener('click', () => {
      if (!confirm('Limpar todos os dados de vagas (isso não pode ser desfeito)?')) return;
      
      spots = Array.from({length: TOTAL_SPOTS}, () => null);
      saveSpotsToFirestore();
      renderGrid();
    });

    // ======= Util: gerar ticket HTML =======
    function buildTicketHtml(vagaNumber, data, calc) {
      const entry = data.entryTime ? new Date(data.entryTime).toLocaleString() : '-';
      const exit = data.exitTime ? new Date(data.exitTime).toLocaleString() : (calc && calc.exit ? new Date(calc.exit).toLocaleString() : '-');
      
      // Calcular tempo total
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
        <div style="margin-bottom:8px"><strong>Entrada:</strong> ${entry}</div>
        <div style="margin-bottom:8px"><strong>Saída:</strong> ${exit}</div>
        <div style="margin-bottom:8px"><strong>Tempo total:</strong> ${timeText}</div>
        <div style="margin-bottom:8px;font-size:18px;font-weight:700;border-top:1px dashed #000;padding-top:8px">Valor: ${valor}</div>
        <div style="font-size:14px;margin-top:6px;text-align:center">Status: ${paidText}</div>
      </div>`;
    }

    function escapeHtml(s) { 
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); 
    }

    // abrir janela para impressão
    function openPrintWindow(html) {
      const w = window.open('', '_blank', 'width=400,height=500');
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Ticket</title><style>
        body{font-family:Arial;margin:0;padding:10px;display:flex;flex-direction:column;justify-content:center;align-items:center;min-height:100vh;background:#f0f0f0}
        .print-button{display:block;margin-top:15px;text-align:center}
        @media print{body{background:#fff;height:auto} .print-button{display:none} @page{size:auto;margin:0}}
      </style></head><body>
        ${html}
        <div class="print-button"><button onclick="window.print();" style="padding:8px 16px;background:#2b7cff;color:#fff;border:none;border-radius:4px;cursor:pointer">Imprimir</button></div>
      </body></html>`);
      w.document.close();
    }

    // ======= Periodic checks para expirar pagamento =======
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
              // expirada a tolerância: volta a ficar ocupada (vermelha)
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
      }, 1000 * 30); // checa a cada 30s
    }

    // ======= Outras interações =======
    // quando o usuário clicar fora do modal fecha
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // impedir submit enter acidental
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });

    // salvar automaticamente quando fechar página
    window.addEventListener('beforeunload', () => {
      saveSpotsToLocalStorage();
    });

    // Atualizar tempo decorrido em tempo real
    setInterval(() => {
      if (overlay.classList.contains('show') && currentIndex !== null && spots[currentIndex]) {
        updateTimeInfo(spots[currentIndex]);
      }
    }, 60000); // Atualiza a cada minuto

    // Atualizar displays quando os campos são alterados
    nameInput.addEventListener('input', () => {
      ownerNameDisplay.textContent = nameInput.value || '-';
    });

    document.querySelectorAll('input[name="vehicleType"], input[name="clientType"]').forEach(input => {
      input.addEventListener('change', () => {
        const vehicleType = getRadio('vehicleType');
        const clientType = getRadio('clientType');
        vehicleTypeDisplay.textContent = (vehicleType === 'carro' ? 'Carro' : 'Moto') + 
                                        (clientType === 'comerciario' ? ' (Comerciário)' : ' (Usuário)');
      });
    });

    // informar ao usuário sobre o comportamento implementado
    console.log('Sistema carregado. Tarifas implementadas: carro/moto, comerciario/usuario, diária (>=9h), tolerância 15 min. Vaga paga fica verde por até 15 min ou até liberar.');