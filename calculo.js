// Lógica pura de divisão de gastos (sem dependência de interface ou banco).
// Todos os valores são inteiros em CENTAVOS para evitar erros de arredondamento.

/**
 * Divide um valor igualmente entre os participantes.
 * Os centavos que sobram vão para os primeiros participantes da lista,
 * de forma determinística (a soma das partes é sempre igual ao valor).
 */
export function dividir(valorCentavos, participantes) {
  const n = participantes.length;
  if (n === 0) return {};
  const base = Math.floor(valorCentavos / n);
  const resto = valorCentavos - base * n;
  const partes = {};
  participantes.forEach((p, i) => { partes[p] = base + (i < resto ? 1 : 0); });
  return partes;
}

/**
 * Ordem usada na divisão: quem pagou primeiro (absorve os centavos que sobram),
 * depois os demais na ordem do cadastro.
 */
export function ordemDivisao(pessoas, participantes, pagador) {
  const parts = ordenarParticipantes(pessoas, participantes);
  return parts.includes(pagador) ? [pagador, ...parts.filter(p => p !== pagador)] : parts;
}

/** Ordena os participantes de um item na ordem do cadastro de pessoas. */
export function ordenarParticipantes(pessoas, participantes) {
  const ordem = pessoas.map(p => p.id);
  return ordem.filter(id => participantes.includes(id));
}

/**
 * Calcula quem deve quanto para quem.
 * @param pessoas    [{id, nome}]
 * @param itens      [{valor, pagador, participantes: [id]}]
 * @param pagamentos [{de, para, valor}]  (acertos já feitos)
 */
export function calcular(pessoas, itens, pagamentos) {
  const ids = pessoas.map(p => p.id);
  const zero = () => Object.fromEntries(ids.map(id => [id, 0]));

  // deve[a][b] = quanto "a" deve para "b" (bruto, antes de compensar b -> a)
  const deve = Object.fromEntries(ids.map(id => [id, zero()]));
  const pago = zero();       // quanto cada um pagou em itens
  const consumo = zero();    // soma das partes de cada um
  const enviados = zero();   // acertos pagos
  const recebidos = zero();  // acertos recebidos
  let total = 0;

  for (const item of itens) {
    if (!ids.includes(item.pagador)) continue;
    const parts = ordemDivisao(pessoas, item.participantes || [], item.pagador);
    if (parts.length === 0) continue;
    const partes = dividir(item.valor, parts);
    pago[item.pagador] += item.valor;
    total += item.valor;
    for (const p of parts) {
      consumo[p] += partes[p];
      if (p !== item.pagador) deve[p][item.pagador] += partes[p];
    }
  }

  for (const pg of pagamentos) {
    if (!ids.includes(pg.de) || !ids.includes(pg.para) || pg.de === pg.para) continue;
    deve[pg.de][pg.para] -= pg.valor;
    enviados[pg.de] += pg.valor;
    recebidos[pg.para] += pg.valor;
  }

  // Compensação par a par (ex.: TV x micro-ondas)
  const pares = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j];
      const liquido = deve[a][b] - deve[b][a];
      if (liquido > 0) pares.push({ de: a, para: b, valor: liquido });
      else if (liquido < 0) pares.push({ de: b, para: a, valor: -liquido });
    }
  }

  // Saldo: positivo = tem a receber; negativo = tem a pagar
  const saldo = Object.fromEntries(ids.map(id =>
    [id, pago[id] - consumo[id] + enviados[id] - recebidos[id]]));

  return { pares, simplificado: simplificar(saldo), saldo, pago, consumo, enviados, recebidos, total };
}

/** Gera o menor conjunto de transferências a partir dos saldos (guloso). */
export function simplificar(saldo) {
  const credores = Object.entries(saldo).filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }));
  const devedores = Object.entries(saldo).filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }));
  credores.sort((x, y) => y.v - x.v);
  devedores.sort((x, y) => y.v - x.v);
  const res = [];
  let i = 0, j = 0;
  while (i < devedores.length && j < credores.length) {
    const valor = Math.min(devedores[i].v, credores[j].v);
    if (valor > 0) res.push({ de: devedores[i].id, para: credores[j].id, valor });
    devedores[i].v -= valor;
    credores[j].v -= valor;
    if (devedores[i].v === 0) i++;
    if (credores[j].v === 0) j++;
  }
  return res;
}

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatarBRL = centavos => fmt.format(centavos / 100);

/** Converte "1.234,56", "900", "900,5", "R$ 89.90" em centavos. Retorna NaN se inválido. */
export function parseValor(texto) {
  let s = String(texto ?? '').replace(/R\$/gi, '').replace(/\s/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Math.round(parseFloat(s) * 100);
}
