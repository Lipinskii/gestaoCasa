import { criarStore } from './store.js';
import { calcular, dividir, ordenarParticipantes, ordemDivisao, formatarBRL as brl, parseValor } from './calculo.js';
import { mesAtual, somarMes, contasDoMes, contasAtrasadas, contarAlertas, nomeMes, mesCurto, vencimentoNoMes } from './mensal.js';

const CATEGORIAS = ['Móveis', 'Eletrodomésticos', 'Cozinha', 'Limpeza', 'Decoração', 'Mercado', 'Contas', 'Outros'];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Preferências do aparelho: grava no localStorage e também num cookie,
// para não se perder se um dos dois for limpo ou bloqueado pelo navegador.
const lerCookie = k => {
  const m = document.cookie.match(new RegExp('(?:^|; )' + k + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
};
const ls = {
  get(k) {
    let v = null;
    try { v = localStorage.getItem(k); } catch { /* bloqueado */ }
    if (v == null) v = lerCookie(k);
    return v;
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch { /* bloqueado */ }
    document.cookie = `${k}=${encodeURIComponent(v)}; max-age=315360000; path=/; SameSite=Lax`;
  }
};
// Pede ao navegador para não apagar os dados do app automaticamente
navigator.storage?.persist?.().catch(() => {});

let store;
let dados = { pessoas: null, itens: [], pagamentos: [], contas: [] };
let carregado = false;
let aba = 'resumo';
let filtro = 'todos';
let mesMensal = mesAtual();
let simplificar = ls.get('casa-gastos-simplificar') === '1';
let eu = ls.get('casa-gastos-eu');
if (eu) ls.set('casa-gastos-eu', eu); // regrava nos dois lugares
let jaPerguntouEu = false;

const nome = id => dados.pessoas?.find(p => p.id === id)?.nome ?? '?';
const nomeEu = id => id === eu ? `${nome(id)} (você)` : nome(id);
function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const dataBR = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
const porData = (a, b) => (b.data || '').localeCompare(a.data || '') || (b.criadoEm || '').localeCompare(a.criadoEm || '');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), 2600);
}
const falhou = e => { console.error(e); toast('Erro ao salvar: ' + (e?.message || e)); };

// ---------------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------------
function render() {
  if (!carregado) return;
  if (!dados.pessoas) { abrirSetup(); return; }
  if ((!eu || !dados.pessoas.some(p => p.id === eu)) && !jaPerguntouEu) { abrirQuemSouEu(); }

  document.querySelectorAll('#abas button').forEach(b => b.classList.toggle('ativa', b.dataset.aba === aba));
  $('#fab').hidden = aba === 'ajustes';
  const alertas = contarAlertas(dados.contas, dados.itens);
  const selo = $('#selo-mensal');
  selo.textContent = alertas > 9 ? '9+' : alertas;
  selo.hidden = alertas === 0;
  const r = calcular(dados.pessoas, dados.itens, dados.pagamentos);
  const telas = { resumo: telaResumo, itens: telaItens, mensal: telaMensal, pagamentos: telaPagamentos, ajustes: telaAjustes };
  $('#tela').innerHTML = telas[aba](r);
}

function telaResumo(r) {
  const lista = simplificar ? r.simplificado : r.pares;
  let html = '';

  if (eu) {
    const s = r.saldo[eu] || 0;
    const txt = s > 0 ? 'Você tem a receber' : s < 0 ? 'Você tem a pagar' : 'Você está quite';
    html += `<div class="card destaque">
      <div class="sub">${esc(nome(eu))}</div>
      <div>${txt}</div>
      <div class="grande ${s > 0 ? 'pos' : s < 0 ? 'neg' : ''}">${brl(Math.abs(s))}</div>
    </div>`;
  }

  html += `<h2>Quem deve para quem</h2><div class="card">`;
  if (lista.length === 0) {
    html += `<div class="vazio" style="padding:14px">Tudo certo! Ninguém deve nada a ninguém.</div>`;
  } else {
    html += lista.map(d => `
      <div class="divida ${d.de === eu || d.para === eu ? 'minha' : ''}">
        <div class="cresce">${esc(nomeEu(d.de))} <span class="seta">→</span> ${esc(nomeEu(d.para))}
          <div class="valor">${brl(d.valor)}</div></div>
        <button class="btn sec peq" data-acao="quitar" data-de="${d.de}" data-para="${d.para}" data-valor="${d.valor}">Quitar</button>
      </div>`).join('');
  }
  html += `</div>
    <label class="switch"><input type="checkbox" data-acao="simplificar" ${simplificar ? 'checked' : ''}>
      Simplificar (menos transferências em vez de acertar par a par)</label>`;

  html += `<h2>Por pessoa</h2><div class="grade3">` + dados.pessoas.map(p => {
    const s = r.saldo[p.id];
    return `<div class="card pessoa">
      <div class="nome">${esc(p.nome)}</div>
      <div class="sub">pagou ${brl(r.pago[p.id])}</div>
      <div class="sub">parte ${brl(r.consumo[p.id])}</div>
      ${r.enviados[p.id] || r.recebidos[p.id] ? `<div class="sub">acertos ${(() => { const a = r.enviados[p.id] - r.recebidos[p.id]; return (a >= 0 ? '+' : '−') + brl(Math.abs(a)); })()}</div>` : ''}
      <div class="valor ${s > 0 ? 'pos' : s < 0 ? 'neg' : ''}">${s > 0 ? '+' : s < 0 ? '−' : ''}${brl(Math.abs(s))}</div>
    </div>`;
  }).join('') + `</div>`;

  html += `<div class="card linha-flex"><div class="cresce">Total gasto na casa<div class="sub">${dados.itens.length} ${dados.itens.length === 1 ? 'item' : 'itens'}</div></div>
    <div class="valor">${brl(r.total)}</div></div>`;
  return html;
}

function descricaoDivisao(item) {
  const parts = ordenarParticipantes(dados.pessoas, item.participantes || []);
  if (parts.length === 1 && parts[0] === item.pagador) return 'só para quem pagou';
  const cada = brl(Math.floor(item.valor / parts.length));
  const nomes = parts.length === dados.pessoas.length ? 'todos' : parts.map(nome).join(' e ');
  return `dividido entre ${esc(nomes)} (${cada} cada)`;
}

function telaItens() {
  const itens = [...dados.itens].sort(porData).filter(i => filtro === 'todos' || i.pagador === filtro);
  let html = `<div class="filtros">
    <button class="chip ${filtro === 'todos' ? 'ativo' : ''}" data-acao="filtro" data-id="todos">Todos</button>
    ${dados.pessoas.map(p => `<button class="chip ${filtro === p.id ? 'ativo' : ''}" data-acao="filtro" data-id="${p.id}">Pagos por ${esc(p.nome)}</button>`).join('')}
  </div>`;
  if (itens.length === 0) {
    return html + `<div class="card vazio">Nenhum item ainda.<br>Toque em <b>+</b> para adicionar a primeira compra.</div>`;
  }
  html += `<div class="card">` + itens.map(i => `
    <div class="item-li" data-acao="editar-item" data-id="${i.id}">
      <div class="cresce">
        <div class="tit">${esc(i.nome)}${i.categoria ? `<span class="tag">${esc(i.categoria)}</span>` : ''}${i.contaId ? `<span class="tag">Mensal</span>` : ''}</div>
        <div class="sub">${dataBR(i.data)} · pago por ${esc(nome(i.pagador))}</div>
        <div class="sub">${descricaoDivisao(i)}</div>
      </div>
      <div class="valor">${brl(i.valor)}</div>
    </div>`).join('') + `</div>`;
  const soma = itens.reduce((s, i) => s + i.valor, 0);
  html += `<div class="sub" style="text-align:right;margin-right:4px">Soma da lista: <b>${brl(soma)}</b></div>`;
  return html;
}

const ROTULO_ESTADO = {
  paga: s => `Paga em ${dataBR(s.pagamento.data).slice(0, 5)} por ${esc(nome(s.pagamento.pagador))}`,
  atrasada: s => `Atrasada há ${-s.dias} ${s.dias === -1 ? 'dia' : 'dias'}`,
  hoje: () => 'Vence hoje',
  breve: s => `Vence em ${s.dias} ${s.dias === 1 ? 'dia' : 'dias'}`,
  pendente: s => `Vence em ${dataBR(s.vencimento).slice(0, 5)}`
};

function cartaoConta(s, mostrarMes = false) {
  const valor = s.pagamento ? s.pagamento.valor : (s.conta.valorPrevisto || 0);
  return `
    <div class="conta ${s.estado}">
      <div class="dia"><b>${s.vencimento.slice(8)}</b><span>${s.vencimento.slice(5, 7)}</span></div>
      <div class="cresce" data-acao="${s.pagamento ? 'editar-item' : 'pagar-conta'}" data-id="${s.pagamento ? s.pagamento.id : s.conta.id}" data-mes="${s.mes}">
        <div class="tit">${esc(s.conta.nome)}${mostrarMes ? ` <span class="sub">· ${mesCurto(s.mes)}</span>` : ''}</div>
        <div class="estado">${ROTULO_ESTADO[s.estado](s)}</div>
      </div>
      <div style="text-align:right">
        <div class="valor ${s.pagamento ? '' : 'sub'}">${valor ? brl(valor) : '—'}</div>
        ${s.pagamento
          ? `<span class="ok">✓</span>`
          : `<button class="btn peq" data-acao="pagar-conta" data-id="${s.conta.id}" data-mes="${s.mes}">Pagar</button>`}
      </div>
      <button class="lapis" aria-label="Editar conta" data-acao="editar-conta" data-id="${s.conta.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
      </button>
    </div>`;
}

function telaMensal() {
  const lista = contasDoMes(dados.contas, mesMensal, dados.itens);
  const atrasadasOutros = contasAtrasadas(dados.contas, dados.itens).filter(s => s.mes !== mesMensal);
  let html = `
    <div class="mes-nav">
      <button class="btn sec peq" data-acao="mes" data-delta="-1" aria-label="Mês anterior">‹</button>
      <div class="cresce" style="text-align:center"><b>${nomeMes(mesMensal)}</b>
        ${mesMensal !== mesAtual() ? `<div><button class="link" data-acao="mes" data-delta="0">voltar para o mês atual</button></div>` : ''}</div>
      <button class="btn sec peq" data-acao="mes" data-delta="1" aria-label="Próximo mês">›</button>
    </div>`;

  if (atrasadasOutros.length) {
    html += `<div class="card alerta"><b>Contas atrasadas de outros meses</b>` +
      atrasadasOutros.map(s => cartaoConta(s, true)).join('') + `</div>`;
  }

  if (dados.contas.length === 0) {
    return html + `<div class="card vazio">Nenhuma conta mensal cadastrada.<br>
      Toque em <b>+</b> para cadastrar aluguel, luz, água, internet…<br>
      <span class="sub">Ela vai aparecer todo mês para vocês marcarem como paga.</span></div>`;
  }
  if (lista.length === 0) return html + `<div class="card vazio">Nenhuma conta ativa neste mês.</div>`;

  const pagas = lista.filter(s => s.pagamento);
  const totalPago = pagas.reduce((t, s) => t + s.pagamento.valor, 0);
  const aPagar = lista.filter(s => !s.pagamento).reduce((t, s) => t + (s.conta.valorPrevisto || 0), 0);
  const semValor = lista.filter(s => !s.pagamento && !s.conta.valorPrevisto).length;
  const pct = Math.round(pagas.length / lista.length * 100);
  html += `
    <div class="card">
      <div class="linha-flex"><div class="cresce"><b>${pagas.length} de ${lista.length}</b> ${lista.length === 1 ? 'conta paga' : 'contas pagas'}</div>
        <div class="sub">${pct}%</div></div>
      <div class="barra"><div style="width:${pct}%"></div></div>
      <div class="linha-flex sub" style="margin-top:8px">
        <div class="cresce">Pago: <b>${brl(totalPago)}</b></div>
        <div>Falta (previsto): <b>${brl(aPagar)}</b>${semValor ? ` + ${semValor} sem valor` : ''}</div>
      </div>
    </div>
    <div class="card">${lista.map(s => cartaoConta(s)).join('')}</div>
    <div class="sub" style="margin:0 4px">Ao marcar como paga, o valor entra na divisão entre os moradores, como um item comum.</div>`;
  return html;
}

function telaPagamentos() {
  const pags = [...dados.pagamentos].sort(porData);
  let html = `<div class="sub" style="margin:4px 4px 12px">Registre aqui quando alguém transferir dinheiro para outro morador.
    O valor é descontado automaticamente do que ainda é devido.</div>`;
  if (pags.length === 0) return html + `<div class="card vazio">Nenhum acerto registrado.</div>`;
  html += `<div class="card">` + pags.map(p => `
    <div class="item-li" data-acao="editar-pagamento" data-id="${p.id}">
      <div class="cresce">
        <div class="tit">${esc(nomeEu(p.de))} <span class="seta">→</span> ${esc(nomeEu(p.para))}</div>
        <div class="sub">${dataBR(p.data)}${p.obs ? ' · ' + esc(p.obs) : ''}</div>
      </div>
      <div class="valor">${brl(p.valor)}</div>
    </div>`).join('') + `</div>`;
  return html;
}

function telaAjustes() {
  const modo = store.tipo === 'firebase'
    ? `Sincronizado pelo Firebase · casa <b>${esc(store.casaId)}</b>`
    : `<b>Modo local</b>: os dados ficam só neste aparelho. Configure o Firebase em <code>config.js</code> para sincronizar entre os três (veja o LEIAME).`;
  return `
    <h2>Neste aparelho</h2>
    <div class="card">
      <label class="campo">Quem é você?
        <select data-acao="eu">${dados.pessoas.map(p => `<option value="${p.id}" ${p.id === eu ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select>
      </label>
      <div class="sub">Usado para destacar o que você deve/recebe e já marcar você como quem pagou.</div>
    </div>

    <h2>Moradores</h2>
    <form class="card" id="form-nomes">
      ${dados.pessoas.map((p, i) => `<label class="campo">Morador ${i + 1}<input name="${p.id}" value="${esc(p.nome)}" required maxlength="30"></label>`).join('')}
      <button class="btn" type="submit">Salvar nomes</button>
    </form>

    <h2>Dados</h2>
    <div class="card">
      <div class="sub" style="margin-bottom:12px">${modo}</div>
      <div class="acoes" style="flex-wrap:wrap">
        <button class="btn sec" data-acao="exportar-csv">Exportar planilha (CSV)</button>
        <button class="btn sec" data-acao="exportar-json">Fazer backup</button>
        <button class="btn sec" data-acao="importar-json">Restaurar backup</button>
      </div>
      <input type="file" id="arquivo-json" accept="application/json,.json" hidden>
    </div>

    <div class="rodape">Gastos da Casa · contato: <a href="https://github.com/lipinskii" target="_blank" rel="noopener">github.com/lipinskii</a></div>`;
}

// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------
function abrirModal(html, aoMontar) {
  const folha = $('#folha');
  for (const k of Object.keys(folha.dataset)) delete folha.dataset[k];
  folha.innerHTML = html;
  $('#modal').hidden = false;
  aoMontar?.($('#folha'));
}
function fecharModal() {
  const folha = $('#folha');
  for (const k of Object.keys(folha.dataset)) delete folha.dataset[k];
  $('#modal').hidden = true;
  folha.innerHTML = '';
}
$('#modal').addEventListener('click', e => {
  if (e.target.id === 'modal' && !$('#folha').dataset.travado) fecharModal();
});

const seg = (nomeCampo, selecionado, tipo = 'radio', marcados = []) =>
  `<div class="seg">${dados.pessoas.map(p => {
    const id = `${nomeCampo}-${p.id}`;
    const chk = tipo === 'radio' ? p.id === selecionado : marcados.includes(p.id);
    return `<input type="${tipo}" name="${nomeCampo}" id="${id}" value="${p.id}" ${chk ? 'checked' : ''}><label for="${id}">${esc(p.nome)}</label>`;
  }).join('')}</div>`;

function abrirSetup() {
  if (!$('#modal').hidden && $('#folha').dataset.tela === 'setup') return;
  abrirModal(`
    <h3>Bem-vindo! Quem mora na casa?</h3>
    <form id="form-setup">
      <label class="campo">Seu nome<input name="p1" required maxlength="30" placeholder="Seu nome" autofocus></label>
      <label class="campo">Morador 2<input name="p2" required maxlength="30" value="Maurício"></label>
      <label class="campo">Morador 3<input name="p3" required maxlength="30" value="Eduardo"></label>
      <button class="btn" style="width:100%" type="submit">Começar</button>
    </form>`, f => { f.dataset.tela = 'setup'; f.dataset.travado = '1'; });
  $('#form-setup').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const pessoas = ['p1', 'p2', 'p3'].map(id => ({ id, nome: fd.get(id).trim() }));
    eu = 'p1'; ls.set('casa-gastos-eu', eu);
    delete $('#folha').dataset.travado;
    fecharModal();
    store.salvarPessoas(pessoas).catch(falhou);
  });
}

function abrirQuemSouEu() {
  if (!$('#modal').hidden) return;
  jaPerguntouEu = true; // pergunta no máximo uma vez por abertura do app
  abrirModal(`
    <h3>Quem é você?</h3>
    <div class="sub" style="margin-bottom:12px">Escolha seu nome neste aparelho (dá para trocar depois em Ajustes).</div>
    <div class="grade3">${dados.pessoas.map(p => `<button class="btn sec" data-acao="sou" data-id="${p.id}">${esc(p.nome)}</button>`).join('')}</div>
    <button class="btn sec" style="width:100%;margin-top:10px" data-acao="fechar">Agora não</button>`);
}

function abrirItem(item, titulo, aviso = '') {
  const editando = !!item?.id;
  item = item || { nome: '', valor: null, data: hoje(), categoria: '', pagador: eu || 'p1',
    participantes: dados.pessoas.map(p => p.id), obs: '' };
  const daConta = !!item.contaId;
  if (daConta && !aviso) {
    const conta = dados.contas.find(c => c.id === item.contaId);
    aviso = `Conta mensal · competência ${mesCurto(item.competencia)}${conta ? ` · vencimento ${dataBR(vencimentoNoMes(conta, item.competencia))}` : ''}`;
  }
  abrirModal(`
    <h3>${titulo || (editando ? (daConta ? 'Pagamento da conta' : 'Editar item') : 'Novo item')}</h3>
    ${aviso ? `<div class="sub" style="margin:-8px 0 12px">${aviso}</div>` : ''}
    <form id="form-item" novalidate>
      <label class="campo">${daConta ? 'Descrição' : 'O que foi comprado?'}<input name="nome" required maxlength="60" placeholder="Ex.: Televisão" value="${esc(item.nome)}"></label>
      <div class="dupla">
        <label class="campo">Valor (R$)<input name="valor" inputmode="decimal" placeholder="0,00" value="${item.valor != null ? (item.valor / 100).toFixed(2).replace('.', ',') : ''}"></label>
        <label class="campo">Data<input type="date" name="data" value="${esc(item.data || hoje())}"></label>
      </div>
      <label class="campo">Categoria<select name="categoria">
        <option value="">—</option>
        ${CATEGORIAS.map(c => `<option ${c === item.categoria ? 'selected' : ''}>${c}</option>`).join('')}
      </select></label>
      <fieldset><legend>Quem pagou?</legend>${seg('pagador', item.pagador)}</fieldset>
      <fieldset><legend>Dividir com <b id="qtd"></b></legend>${seg('part', null, 'checkbox', item.participantes)}</fieldset>
      <div class="previa" id="previa"></div>
      <label class="campo">Observação (opcional)<input name="obs" maxlength="120" value="${esc(item.obs || '')}"></label>
      <div class="erro" id="erro"></div>
      <div class="acoes">
        ${editando ? `<button type="button" class="btn perigo" data-acao="excluir-item">${daConta ? 'Desfazer pagamento' : 'Excluir'}</button>` : ''}
        <button type="button" class="btn sec" data-acao="fechar">Cancelar</button>
        <button type="submit" class="btn cresce">${daConta && !editando ? 'Marcar como paga' : 'Salvar'}</button>
      </div>
    </form>`);

  const form = $('#form-item');
  const ler = () => {
    const fd = new FormData(form);
    return {
      nome: fd.get('nome').trim(),
      valor: parseValor(fd.get('valor')),
      data: fd.get('data') || hoje(),
      categoria: fd.get('categoria'),
      pagador: fd.get('pagador'),
      participantes: fd.getAll('part'),
      obs: fd.get('obs').trim()
    };
  };
  const atualizarPrevia = () => {
    const v = ler();
    const n = v.participantes.length;
    $('#qtd').textContent = n ? `(${n} ${n === 1 ? 'pessoa' : 'pessoas'})` : '';
    const prev = $('#previa');
    if (!n) { prev.innerHTML = 'Selecione pelo menos uma pessoa.'; return; }
    if (!(v.valor > 0)) { prev.innerHTML = 'Digite o valor para ver a divisão.'; return; }
    const parts = ordemDivisao(dados.pessoas, v.participantes, v.pagador);
    const partes = dividir(v.valor, parts);
    const linhas = parts.filter(p => p !== v.pagador)
      .map(p => `<div>${esc(nome(p))} deve <b>${brl(partes[p])}</b> para ${esc(nome(v.pagador))}</div>`);
    prev.innerHTML = `<div>Cada parte: <b>${brl(Math.floor(v.valor / n))}</b>${v.valor % n ? ' (centavos arredondados)' : ''}</div>`
      + (linhas.length ? linhas.join('') : `<div class="sub">Ninguém deve nada por este item.</div>`);
  };
  form.addEventListener('input', atualizarPrevia);
  form.addEventListener('change', atualizarPrevia);
  atualizarPrevia();

  form.addEventListener('submit', e => {
    e.preventDefault();
    const v = ler();
    const erro = msg => { $('#erro').textContent = msg; };
    if (!v.nome) return erro('Informe o nome do item.');
    if (!(v.valor > 0)) return erro('Informe um valor válido (ex.: 900 ou 1.234,56).');
    if (!v.pagador) return erro('Escolha quem pagou.');
    if (!v.participantes.length) return erro('Escolha com quem dividir.');
    const salvar = { ...v, participantes: ordenarParticipantes(dados.pessoas, v.participantes) };
    if (editando) { salvar.id = item.id; salvar.criadoEm = item.criadoEm; }
    else salvar.criadoEm = new Date().toISOString();
    if (daConta) { salvar.contaId = item.contaId; salvar.competencia = item.competencia; }
    salvar.atualizadoEm = new Date().toISOString();
    fecharModal();
    store.salvarItem(salvar).catch(falhou);
    toast(daConta && !editando ? 'Conta marcada como paga' : editando ? 'Item atualizado' : 'Item adicionado');
  });

  $('#folha').querySelector('[data-acao="excluir-item"]')?.addEventListener('click', () => {
    if (!confirm(daConta ? `Desfazer o pagamento de "${item.nome}"? A conta volta a ficar em aberto.` : `Excluir "${item.nome}"?`)) return;
    fecharModal();
    store.excluirItem(item.id).catch(falhou);
    toast(daConta ? 'Pagamento desfeito' : 'Item excluído');
  });
}

function abrirPagarConta(conta, mes) {
  const valor = conta.valorPrevisto || null;
  abrirItem({
    nome: `${conta.nome} (${mesCurto(mes)})`, valor, data: hoje(), categoria: conta.categoria || 'Contas',
    pagador: conta.pagadorPadrao || eu || 'p1', participantes: conta.participantes?.length ? conta.participantes : dados.pessoas.map(p => p.id),
    obs: '', contaId: conta.id, competencia: mes
  }, `Pagar ${esc(conta.nome)}`,
  `Competência ${mesCurto(mes)} · vencimento ${dataBR(vencimentoNoMes(conta, mes))}${valor ? '' : ' · confira o valor da fatura'}`);
}

function abrirConta(conta) {
  const editando = !!conta;
  conta = conta || { nome: '', valorPrevisto: null, diaVencimento: 10, categoria: 'Contas', pagadorPadrao: '',
    participantes: dados.pessoas.map(p => p.id), inicio: mesMensal, fim: null, obs: '' };
  const v = conta.valorPrevisto ? (conta.valorPrevisto / 100).toFixed(2).replace('.', ',') : '';
  abrirModal(`
    <h3>${editando ? 'Editar conta mensal' : 'Nova conta mensal'}</h3>
    <form id="form-conta" novalidate>
      <label class="campo">Conta<input name="nome" required maxlength="40" placeholder="Ex.: Luz, Internet, Aluguel" value="${esc(conta.nome)}"></label>
      <div class="dupla">
        <label class="campo">Valor previsto (R$)<input name="valor" inputmode="decimal" placeholder="varia" value="${v}"></label>
        <label class="campo">Dia do vencimento<input name="dia" type="number" inputmode="numeric" min="1" max="31" value="${esc(conta.diaVencimento)}"></label>
      </div>
      <div class="sub" style="margin:-6px 0 12px">Se o valor muda todo mês (luz, água), deixe em branco: você digita o valor real ao pagar.</div>
      <div class="dupla">
        <label class="campo">Categoria<select name="categoria">
          ${CATEGORIAS.map(c => `<option ${c === conta.categoria ? 'selected' : ''}>${c}</option>`).join('')}
        </select></label>
        <label class="campo">Começa em<input name="inicio" type="month" value="${esc(conta.inicio || mesMensal)}"></label>
      </div>
      <fieldset><legend>Quem costuma pagar? <span class="sub">(opcional)</span></legend>
        <div class="seg">${dados.pessoas.map(p => {
          const id = `pp-${p.id}`;
          return `<input type="radio" name="pagadorPadrao" id="${id}" value="${p.id}" ${p.id === conta.pagadorPadrao ? 'checked' : ''}><label for="${id}">${esc(p.nome)}</label>`;
        }).join('')}</div></fieldset>
      <fieldset><legend>Dividir com</legend>${seg('part', null, 'checkbox', conta.participantes || [])}</fieldset>
      <label class="campo">Observação (opcional)<input name="obs" maxlength="120" placeholder="Ex.: débito automático, código do cliente" value="${esc(conta.obs || '')}"></label>
      ${editando ? `<div class="sub" style="margin-bottom:10px">${conta.fim
        ? `Encerrada: aparece até <b>${mesCurto(conta.fim)}</b>. <button type="button" class="link" data-acao="reativar-conta">Reativar</button>`
        : `Repete todo mês desde ${mesCurto(conta.inicio)}. <button type="button" class="link" data-acao="encerrar-conta">Encerrar após ${mesCurto(mesMensal)}</button>`}</div>` : ''}
      <div class="erro" id="erro"></div>
      <div class="acoes">
        ${editando ? `<button type="button" class="btn perigo" data-acao="excluir-conta">Excluir</button>` : ''}
        <button type="button" class="btn sec" data-acao="fechar">Cancelar</button>
        <button type="submit" class="btn cresce">Salvar</button>
      </div>
    </form>`);

  const form = $('#form-conta');
  const ler = () => {
    const fd = new FormData(form);
    const txtValor = fd.get('valor').trim();
    return {
      nome: fd.get('nome').trim(),
      valorPrevisto: txtValor ? parseValor(txtValor) : 0,
      diaVencimento: parseInt(fd.get('dia'), 10),
      categoria: fd.get('categoria'),
      inicio: fd.get('inicio') || mesMensal,
      pagadorPadrao: fd.get('pagadorPadrao') || '',
      participantes: ordenarParticipantes(dados.pessoas, fd.getAll('part')),
      obs: fd.get('obs').trim()
    };
  };
  const gravar = (extra = {}) => {
    const v = { ...ler(), ...extra };
    const erro = msg => { $('#erro').textContent = msg; return false; };
    if (!v.nome) return erro('Informe o nome da conta.');
    if (Number.isNaN(v.valorPrevisto) || v.valorPrevisto < 0) return erro('Valor previsto inválido.');
    if (!(v.diaVencimento >= 1 && v.diaVencimento <= 31)) return erro('O dia do vencimento deve ser de 1 a 31.');
    if (!v.participantes.length) return erro('Escolha com quem dividir.');
    if (!/^\d{4}-\d{2}$/.test(v.inicio)) return erro('Mês de início inválido.');
    const salvar = { ...v, fim: 'fim' in extra ? extra.fim : (conta.fim || null) };
    if (salvar.fim && salvar.fim < salvar.inicio) return erro('A conta não pode terminar antes de começar.');
    if (editando) { salvar.id = conta.id; salvar.criadoEm = conta.criadoEm; }
    else salvar.criadoEm = new Date().toISOString();
    fecharModal();
    store.salvarConta(salvar).catch(falhou);
    return true;
  };
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (gravar()) toast(editando ? 'Conta atualizada' : 'Conta cadastrada');
  });
  const f = $('#folha');
  f.querySelector('[data-acao="encerrar-conta"]')?.addEventListener('click', () => {
    if (confirm(`Encerrar "${conta.nome}"? Ela deixa de aparecer a partir de ${mesCurto(somarMes(mesMensal, 1))}. O histórico de pagamentos é mantido.`)
      && gravar({ fim: mesMensal })) toast('Conta encerrada');
  });
  f.querySelector('[data-acao="reativar-conta"]')?.addEventListener('click', () => {
    if (gravar({ fim: null })) toast('Conta reativada');
  });
  f.querySelector('[data-acao="excluir-conta"]')?.addEventListener('click', () => {
    const pagos = dados.itens.filter(i => i.contaId === conta.id).length;
    const msg = pagos
      ? `Excluir "${conta.nome}"? Os ${pagos} pagamento(s) já registrados continuam na lista de itens. Se só não quer mais que ela repita, use "Encerrar".`
      : `Excluir "${conta.nome}"?`;
    if (!confirm(msg)) return;
    fecharModal();
    store.excluirConta(conta.id).catch(falhou);
    toast('Conta excluída');
  });
}

function abrirPagamento(pg) {
  const editando = !!pg?.id;
  pg = { de: eu || 'p1', para: dados.pessoas.find(p => p.id !== (eu || 'p1')).id, valor: null, data: hoje(), obs: '', ...pg };
  abrirModal(`
    <h3>${editando ? 'Editar acerto' : 'Registrar pagamento'}</h3>
    <form id="form-pag" novalidate>
      <fieldset><legend>Quem pagou?</legend>${seg('de', pg.de)}</fieldset>
      <fieldset><legend>Para quem?</legend>${seg('para', pg.para)}</fieldset>
      <div class="dupla">
        <label class="campo">Valor (R$)<input name="valor" inputmode="decimal" placeholder="0,00" value="${pg.valor != null ? (pg.valor / 100).toFixed(2).replace('.', ',') : ''}"></label>
        <label class="campo">Data<input type="date" name="data" value="${esc(pg.data)}"></label>
      </div>
      <label class="campo">Observação (opcional)<input name="obs" maxlength="120" placeholder="Ex.: Pix" value="${esc(pg.obs || '')}"></label>
      <div class="erro" id="erro"></div>
      <div class="acoes">
        ${editando ? `<button type="button" class="btn perigo" data-acao="excluir-pag">Excluir</button>` : ''}
        <button type="button" class="btn sec" data-acao="fechar">Cancelar</button>
        <button type="submit" class="btn cresce">Salvar</button>
      </div>
    </form>`);
  const form = $('#form-pag');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const v = { de: fd.get('de'), para: fd.get('para'), valor: parseValor(fd.get('valor')),
      data: fd.get('data') || hoje(), obs: fd.get('obs').trim() };
    if (v.de === v.para) return ($('#erro').textContent = 'Quem pagou e quem recebeu precisam ser pessoas diferentes.');
    if (!(v.valor > 0)) return ($('#erro').textContent = 'Informe um valor válido.');
    if (editando) { v.id = pg.id; v.criadoEm = pg.criadoEm; } else v.criadoEm = new Date().toISOString();
    fecharModal();
    store.salvarPagamento(v).catch(falhou);
    toast('Pagamento registrado');
  });
  $('#folha').querySelector('[data-acao="excluir-pag"]')?.addEventListener('click', () => {
    if (!confirm('Excluir este acerto?')) return;
    fecharModal();
    store.excluirPagamento(pg.id).catch(falhou);
    toast('Acerto excluído');
  });
}

// ---------------------------------------------------------------------------
// Exportação / backup
// ---------------------------------------------------------------------------
function baixar(nomeArq, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nomeArq });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportarCSV() {
  const c = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const v = n => (n / 100).toFixed(2).replace('.', ',');
  const linhas = [['Tipo', 'Data', 'Descrição', 'Categoria', 'Valor', 'Pago por', 'Dividido entre', 'Para', 'Observação'].map(c).join(';')];
  for (const i of [...dados.itens].sort(porData))
    linhas.push(['Item', dataBR(i.data), i.nome, i.categoria, v(i.valor), nome(i.pagador),
      ordenarParticipantes(dados.pessoas, i.participantes).map(nome).join(', '), '', i.obs].map(c).join(';'));
  for (const p of [...dados.pagamentos].sort(porData))
    linhas.push(['Acerto', dataBR(p.data), '', '', v(p.valor), nome(p.de), '', nome(p.para), p.obs].map(c).join(';'));
  baixar(`gastos-da-casa-${hoje()}.csv`, '﻿' + linhas.join('\r\n'), 'text/csv;charset=utf-8');
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------
$('#abas').addEventListener('click', e => {
  const b = e.target.closest('button[data-aba]');
  if (!b) return;
  aba = b.dataset.aba;
  render();
  window.scrollTo(0, 0);
});

$('#fab').addEventListener('click', () =>
  aba === 'pagamentos' ? abrirPagamento() : aba === 'mensal' ? abrirConta() : abrirItem());

document.addEventListener('click', e => {
  const el = e.target.closest('[data-acao]');
  if (!el) return;
  const { acao, id } = el.dataset;
  switch (acao) {
    case 'fechar': fecharModal(); break;
    case 'filtro': filtro = id; render(); break;
    case 'mes': {
      const d = Number(el.dataset.delta);
      mesMensal = d === 0 ? mesAtual() : somarMes(mesMensal, d);
      render(); break;
    }
    case 'pagar-conta': {
      const conta = dados.contas.find(c => c.id === id);
      if (conta) abrirPagarConta(conta, el.dataset.mes);
      break;
    }
    case 'editar-conta': abrirConta(dados.contas.find(c => c.id === id)); break;
    case 'editar-item': abrirItem(dados.itens.find(i => i.id === id)); break;
    case 'editar-pagamento': abrirPagamento(dados.pagamentos.find(p => p.id === id)); break;
    case 'quitar': abrirPagamento({ de: el.dataset.de, para: el.dataset.para, valor: Number(el.dataset.valor) }); break;
    case 'sou':
      eu = id; ls.set('casa-gastos-eu', eu);
      delete $('#folha').dataset.travado; fecharModal(); render(); break;
    case 'exportar-csv': exportarCSV(); break;
    case 'exportar-json':
      baixar(`backup-gastos-da-casa-${hoje()}.json`,
        JSON.stringify({ versao: 2, pessoas: dados.pessoas, itens: dados.itens, pagamentos: dados.pagamentos, contas: dados.contas }, null, 2),
        'application/json');
      break;
    case 'importar-json': $('#arquivo-json').click(); break;
  }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset?.acao === 'simplificar') {
    simplificar = el.checked; ls.set('casa-gastos-simplificar', simplificar ? '1' : '0'); render();
  } else if (el.dataset?.acao === 'eu') {
    eu = el.value; ls.set('casa-gastos-eu', eu); toast(`Você é ${nome(eu)} neste aparelho`);
  } else if (el.id === 'arquivo-json' && el.files[0]) {
    try {
      const json = JSON.parse(await el.files[0].text());
      if (!Array.isArray(json.itens)) throw new Error('arquivo não parece um backup deste app');
      if (!confirm(`Restaurar ${json.itens.length} itens e ${(json.pagamentos || []).length} acertos? Itens com o mesmo ID serão substituídos.`)) return;
      await store.importar(json);
      toast('Backup restaurado');
    } catch (err) { toast('Não foi possível restaurar: ' + err.message); }
    el.value = '';
  }
});

document.addEventListener('submit', e => {
  if (e.target.id !== 'form-nomes') return;
  e.preventDefault();
  const fd = new FormData(e.target);
  const pessoas = dados.pessoas.map(p => ({ id: p.id, nome: (fd.get(p.id) || '').trim() || p.nome }));
  store.salvarPessoas(pessoas).catch(falhou);
  toast('Nomes salvos');
});

function atualizarSync(estado) {
  const el = $('#sync');
  if (store.tipo === 'local') { el.className = 'sync'; el.textContent = 'Modo local'; return; }
  if (estado.pendente || !navigator.onLine) { el.className = 'sync pend'; el.textContent = 'Offline · pendente'; }
  else { el.className = 'sync ok'; el.textContent = 'Sincronizado'; }
}

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------
(async () => {
  try {
    store = await criarStore();
  } catch (err) {
    console.error(err);
    $('#tela').innerHTML = `<div class="card"><b>Não foi possível conectar ao Firebase.</b>
      <div class="sub" style="margin-top:6px">${esc(err.message || err)}</div>
      <div class="sub" style="margin-top:6px">Confira o <code>config.js</code>, se o login anônimo está ativado e sua conexão com a internet.</div></div>`;
    return;
  }
  store.subscribe(estado => {
    dados = { pessoas: estado.pessoas, itens: estado.itens || [], pagamentos: estado.pagamentos || [], contas: estado.contas || [] };
    carregado = true;
    atualizarSync(estado);
    render();
  }, err => {
    console.error(err);
    toast('Erro de sincronização: ' + err.message);
  });
  window.addEventListener('online', () => render());
  window.addEventListener('offline', () => atualizarSync({ pendente: true }));
})();