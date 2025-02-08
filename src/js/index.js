
const comerciarioCheckbox = document.getElementById('comerciario');
const usuarioComumCheckbox = document.getElementById('usuarioComum');
const carroCheckbox = document.getElementById('carro');
const motoCheckbox = document.getElementById('moto');

comerciarioCheckbox.addEventListener('change', function() {
    usuarioComumCheckbox.checked = !this.checked;
});

usuarioComumCheckbox.addEventListener('change', function() {
    comerciarioCheckbox.checked = !this.checked;
});

carroCheckbox.addEventListener('change', function() {
    motoCheckbox.checked = !this.checked;
});

motoCheckbox.addEventListener('change', function() {
    carroCheckbox.checked = !this.checked;
});

document.getElementById('parkingForm').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const entryTime = document.getElementById('entryTime').value;
    const exitTime = document.getElementById('exitTime').value;
    const userType = comerciarioCheckbox.checked ? 'comerciario' : 'usuario';
    const vehicleType = carroCheckbox.checked ? 'car' : 'moto';
    
    if (!entryTime || !exitTime) {
        showError('Por favor, preencha todos os campos corretamente.');
        return;
    }
    
    const entry = new Date(`2000-01-01T${entryTime}`);
    const exit = new Date(`2000-01-01T${exitTime}`);
    
    if (exit <= entry) {
        exit.setDate(exit.getDate() + 1);
    }
    
    const durationMs = exit - entry;
    let durationMinutes = Math.floor(durationMs / (1000 * 60));
    
    // Aplicar tolerância de 15 minutos
    durationMinutes = Math.max(0, durationMinutes - 15);
    
    const durationHours = Math.ceil(durationMinutes / 60);
    
    let totalCost = 0;
    if (durationHours > 0) {
        if (userType === 'comerciario') {
            totalCost = 2 + (durationHours - 1) * 2;
        } else {
            totalCost = 4 + (durationHours - 1) * 3;
        }
    }

    // Aplicar desconto para motos
    if (vehicleType === 'moto') {
        totalCost /= 2;
    }
    
    const resultElement = document.getElementById('result');
    resultElement.innerHTML = `
        Tipo de Usuário: ${userType === 'comerciario' ? 'Comerciário' : 'Usuário Comum'}<br>
        Veículo: ${vehicleType === 'moto' ? 'Moto' : 'Carro'}<br>
        Duração: ${durationMinutes} minuto(s)<br>
        Horas cobradas: ${durationHours}<br>
        Valor Total: R$ ${totalCost.toFixed(2)}
    `;
});

function showError(message) {
    const resultElement = document.getElementById('result');
    resultElement.innerHTML = `<p class="error">${message}</p>`;
}