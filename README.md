# Documentação do Projeto EstacionaFácil

## Introdução
O **EstacionaFácil** é um sistema web para cálculo de tarifas de estacionamento para carros e motos, aplicando regras diferenciadas para comerciários e usuários comuns. O sistema considera uma tolerância de 15 minutos e aplica descontos conforme o tipo de veículo.

## Tecnologias Utilizadas
- **HTML5** para estruturação da página
- **CSS3** para estilização
- **JavaScript (Vanilla JS)** para interatividade e cálculo das tarifas

## Estrutura do Projeto
```
EstacionaFacil/
│── index.html      # Estrutura principal do sistema
│── src/
│   ├── css/
│   │   ├── style.css  # Estilos da interface
│   ├── js/
│   │   ├── index.js   # Lógica de cálculo e interatividade
```

## Funcionalidades
- Seleção de hora de entrada e saída
- Escolha entre **comerciário** e **usuário comum**
- Escolha entre **carro** e **moto**
- Cálculo automático da tarifa com base no tempo de permanência
- Aplicação de desconto para motos e regras de cobrança diferenciadas

## Regras de Cobrança
- **Tolerância**: Os primeiros 15 minutos são gratuitos
- **Comerciário**:
  - Primeira hora: R$ 2,00
  - Demais horas: R$ 2,00 por hora adicional
- **Usuário Comum**:
  - Primeira hora: R$ 4,00
  - Demais horas: R$ 3,00 por hora adicional
- **Desconto para motos**: O valor é reduzido pela metade

## Código HTML Principal (index.html)
Estrutura básica do documento HTML, incluindo formulário de entrada e seleção de usuário e veículo.

## Estilização (style.css)
- Define a organização visual do formulário e da resposta de cálculo
- Garante responsividade

## Lógica de Cálculo (index.js)
- Obtém valores de entrada e saída
- Aplica regras de cobrança
- Exibe o valor total na tela

## Como Usar
1. Acesse a página **index.html**
2. Informe os horários de entrada e saída
3. Escolha o tipo de usuário e veículo
4. Clique em **Calcular Tarifa**
5. O resultado será exibido na tela

## Melhorias Futuras
- Implementar backend para registro de usuários e histórico de estacionamento
- Permitir personalização das tarifas
- Criar versão mobile-friendly

## Conclusão
O **EstacionaFácil** é uma solução simples e eficiente para o cálculo de tarifas de estacionamento, garantindo praticidade e economia para diferentes tipos de usuários.

onamento