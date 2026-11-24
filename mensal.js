// Lógica das contas mensais (sem interface). Meses no formato "AAAA-MM",
// datas no formato "AAAA-MM-DD".

const pad = n => String(n).padStart(2, '0');

export function hojeISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const mesDe = data => data.slice(0, 7);
export const mesAtual = () => mesDe(hojeISO());

export function somarMes(mes, n) {
  const [a, m] = mes.split('-').map(Number);
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

export function diasNoMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return new Date(a, m, 0).getDate();
}

/** Diferença em dias entre duas datas AAAA-MM-DD (b - a). */
export function diasEntre(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Data de vencimento da conta no mês (dia 31 vira o último dia em meses curtos). */
export function vencimentoNoMes(conta, mes) {
  const dia = Math.min(Math.max(1, Number(conta.diaVencimento) || 1), diasNoMes(mes));
  return `${mes}-${pad(dia)}`;
}

export function contaAtivaNoMes(conta, mes) {
  return (!conta.inicio || conta.inicio <= mes) && (!conta.fim || mes <= conta.fim);
}

export function pagamentoDaConta(conta, mes, itens) {
  return itens.find(i => i.contaId === conta.id && i.competencia === mes) || null;
}

/**
 * Situação de uma conta num mês.
 * estado: 'paga' | 'atrasada' | 'hoje' | 'breve' (até 5 dias) | 'pendente'
 */
export function statusConta(conta, mes, itens, hoje = hojeISO()) {
  const vencimento = vencimentoNoMes(conta, mes);
  const pagamento = pagamentoDaConta(conta, mes, itens);
  const dias = diasEntre(hoje, vencimento); // negativo = já venceu
  let estado;
  if (pagamento) estado = 'paga';
  else if (dias < 0) estado = 'atrasada';
  else if (dias === 0) estado = 'hoje';
  else if (dias <= 5) estado = 'breve';
  else estado = 'pendente';
  return { conta, mes, vencimento, pagamento, dias, estado };
}

/** Contas do mês, ordenadas pelo vencimento. */
export function contasDoMes(contas, mes, itens, hoje = hojeISO()) {
  return contas
    .filter(c => contaAtivaNoMes(c, mes))
    .map(c => statusConta(c, mes, itens, hoje))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.conta.nome.localeCompare(b.conta.nome));
}

/** Todas as contas vencidas e não pagas (até 24 meses para trás). */
export function contasAtrasadas(contas, itens, hoje = hojeISO()) {
  const atual = mesDe(hoje);
  const res = [];
  for (const c of contas) {
    let mes = c.inicio && c.inicio > somarMes(atual, -24) ? c.inicio : somarMes(atual, -24);
    for (; mes <= atual; mes = somarMes(mes, 1)) {
      if (!contaAtivaNoMes(c, mes)) continue;
      const s = statusConta(c, mes, itens, hoje);
      if (s.estado === 'atrasada') res.push(s);
    }
  }
  return res.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}

/** Quantidade de contas que pedem atenção (atrasadas + vencendo em até 5 dias). */
export function contarAlertas(contas, itens, hoje = hojeISO()) {
  const atrasadas = contasAtrasadas(contas, itens, hoje).length;
  const proximas = [mesDe(hoje), somarMes(mesDe(hoje), 1)]
    .flatMap(m => contasDoMes(contas, m, itens, hoje))
    .filter(s => s.estado === 'hoje' || s.estado === 'breve').length;
  return atrasadas + proximas;
}

export function nomeMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  const s = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export const mesCurto = mes => `${mes.slice(5, 7)}/${mes.slice(0, 4)}`;