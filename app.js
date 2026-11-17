import { criarStore } from './store.js';
import { calcular, dividir, ordenarParticipantes, ordemDivisao, formatarBRL as brl, parseValor } from './calculo.js';

const CATEGORIAS = ['Móveis', 'Eletrodomésticos', 'Cozinha', 'Limpeza', 'Decoração', 'Mercado', 'Contas', 'Outros'];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignora */ } }
};

let store;
let dados = { pessoas: null, itens: [], pagamentos: [] };
let carregado = false;
let aba = 'resumo';
let filtro = 'todos';
let simplificar = ls.get('casa-gastos-simplificar') === '1';
let eu = ls.get('casa-gastos-eu');

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
  if (!eu || !dados.pessoas.some(p => p.id === eu)) { abrirQuemSouEu(); }

  document.querySelectorAll('#abas button').forEach(b => b.classList.toggle('ativa', b.dataset.aba === aba));
  $('#fab').hidden = aba === 'ajustes';
  const r = calcular(dados.pessoas, dados.itens, dados.pagamentos);
  const telas = { resumo: telaResumo, itens: telaItens, pagamentos: telaPagamentos, ajustes: telaAjustes };
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
        <div class="tit">${esc(i.nome)}${i.categoria ? `<span class="tag">${esc(i.categoria)}</span>` : ''}</div>
        <div class="sub">${dataBR(i.data)} · pago por ${esc(nome(i.pagador))}</div>
        <div class="sub">${descricaoDivisao(i)}</div>
      </div>
      <div class="valor">${brl(i.valor)}</div>
    </div>`).join('') + `</div>`;
  const soma = itens.reduce((s, i) => s + i.valor, 0);
  html += `<div class="sub" style="text-align:right;margin-right:4px">Soma da lista: <b>${brl(soma)}</b></div>`;
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

    <div class="rodape">Gastos da Casa · contato: <a href="https://github.com/Akasshw" target="_blank" rel="noopener">github.com/Akasshw</a></div>`;
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
  abrirModal(`
    <h3>Quem é você?</h3>
    <div class="sub" style="margin-bottom:12px">Escolha seu nome neste aparelho (dá para trocar depois em Ajustes).</div>
    <div class="grade3">${dados.pessoas.map(p => `<button class="btn sec" data-acao="sou" data-id="${p.id}">${esc(p.nome)}</button>`).join('')}</div>`,
    f => { f.dataset.travado = '1'; });
}

function abrirItem(item) {
  const editando = !!item;
  item = item || { nome: '', valor: null, data: hoje(), categoria: '', pagador: eu || 'p1',
    participantes: dados.pessoas.map(p => p.id), obs: '' };
  abrirModal(`
    <h3>${editando ? 'Editar item' : 'Novo item'}</h3>
    <form id="form-item" novalidate>
      <label class="campo">O que foi comprado?<input name="nome" required maxlength="60" placeholder="Ex.: Televisão" value="${esc(item.nome)}"></label>
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
        ${editando ? `<button type="button" class="btn perigo" data-acao="excluir-item">Excluir</button>` : ''}
        <button type="button" class="btn sec" data-acao="fechar">Cancelar</button>
        <button type="submit" class="btn cresce">Salvar</button>
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
    salvar.atualizadoEm = new Date().toISOString();
    fecharModal();
    store.salvarItem(salvar).catch(falhou);
    toast(editando ? 'Item atualizado' : 'Item adicionado');
  });

  $('#folha').querySelector('[data-acao="excluir-item"]')?.addEventListener('click', () => {
    if (!confirm(`Excluir "${item.nome}"?`)) return;
    fecharModal();
    store.excluirItem(item.id).catch(falhou);
    toast('Item excluído');
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

$('#fab').addEventListener('click', () => aba === 'pagamentos' ? abrirPagamento() : abrirItem());

document.addEventListener('click', e => {
  const el = e.target.closest('[data-acao]');
  if (!el) return;
  const { acao, id } = el.dataset;
  switch (acao) {
    case 'fechar': fecharModal(); break;
    case 'filtro': filtro = id; render(); break;
    case 'editar-item': abrirItem(dados.itens.find(i => i.id === id)); break;
    case 'editar-pagamento': abrirPagamento(dados.pagamentos.find(p => p.id === id)); break;
    case 'quitar': abrirPagamento({ de: el.dataset.de, para: el.dataset.para, valor: Number(el.dataset.valor) }); break;
    case 'sou':
      eu = id; ls.set('casa-gastos-eu', eu);
      delete $('#folha').dataset.travado; fecharModal(); render(); break;
    case 'exportar-csv': exportarCSV(); break;
    case 'exportar-json':
      baixar(`backup-gastos-da-casa-${hoje()}.json`,
        JSON.stringify({ versao: 1, pessoas: dados.pessoas, itens: dados.itens, pagamentos: dados.pagamentos }, null, 2),
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
    dados = { pessoas: estado.pessoas, itens: estado.itens || [], pagamentos: estado.pagamentos || [] };
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
