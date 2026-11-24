// Leitura de Nota Fiscal de Consumidor (NFC-e) a partir do PDF da SEFAZ
// ou de uma foto do cupom. Tudo roda no próprio celular; as bibliotecas
// são baixadas sob demanda na primeira vez que forem usadas.

import { parseValor } from './calculo.js';

const CDN = 'https://cdn.jsdelivr.net/npm';
export const LIBS = {
  pdfjs: `${CDN}/pdfjs-dist@4.10.38/build/pdf.min.mjs`,
  pdfjsWorker: `${CDN}/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`,
  tesseract: `${CDN}/tesseract.js@7.0.0/dist/tesseract.min.js`,
  jsqr: `${CDN}/jsqr@1.4.0/dist/jsQR.js`
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const carregados = {};
function carregarScript(url, global) {
  if (window[global]) return Promise.resolve(window[global]);
  carregados[url] ||= new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload = () => ok(window[global]);
    s.onerror = () => erro(new Error('Não foi possível baixar ' + url.split('/').slice(-3).join('/') + '. Verifique a internet.'));
    document.head.appendChild(s);
  });
  return carregados[url];
}

const numero = txt => {
  const s = String(txt).trim();
  if (!s) return NaN;
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
};

/** Dados contidos na chave de acesso de 44 dígitos. */
export function lerChave(chave) {
  const c = String(chave || '').replace(/\D/g, '');
  if (c.length !== 44) return null;
  return {
    chave: c, uf: c.slice(0, 2), ano: '20' + c.slice(2, 4), mes: c.slice(4, 6),
    cnpj: c.slice(6, 20), modelo: c.slice(20, 22), serie: String(Number(c.slice(22, 25))),
    numero: String(Number(c.slice(25, 34)))
  };
}

/** Extrai a chave de acesso do texto do QR code (URL da SEFAZ). */
export function chaveDoQR(texto) {
  const m = String(texto || '').match(/[?&]p=(\d{44})/) || String(texto || '').match(/(\d{44})/);
  return m ? m[1] : null;
}

/** "americanas sa - 0169" -> "Americanas" */
export function nomeLoja(razao) {
  let s = String(razao || '').replace(/\s+-\s+\d+\s*$/, '').trim();
  s = s.replace(/\b(s\/?a|ltda|eireli|me|epp|comercio de alimentos|com[eé]rcio|ind[uú]stria)\.?\s*$/i, '').trim();
  s = s.replace(/[,.-]+$/, '').trim();
  s = s.replace(/(\s+\S{1,2})+$/, '').trim(); // sobras curtas (ex.: "sa" lido como "90")
  return s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()) || 'Compra';
}

/**
 * Aplica o desconto da nota proporcionalmente aos itens, para a soma bater
 * com o valor pago. Os centavos que sobram vão para os itens mais caros.
 */
export function distribuirDesconto(itens, desconto) {
  const soma = itens.reduce((t, i) => t + i.valor, 0);
  if (!(desconto > 0) || !(soma > 0) || desconto >= soma) return itens;
  const parcelas = itens.map(i => Math.floor(desconto * i.valor / soma));
  let resto = desconto - parcelas.reduce((t, v) => t + v, 0);
  const ordem = itens.map((_, k) => k).sort((a, b) => itens[b].valor - itens[a].valor);
  for (let k = 0; resto > 0; k = (k + 1) % ordem.length, resto--) parcelas[ordem[k]]++;
  return itens.map((i, k) => ({ ...i, valorBruto: i.valor, desconto: parcelas[k], valor: i.valor - parcelas[k] }));
}

// ---------------------------------------------------------------------------
// PDF da SEFAZ ("Imprimir" > "Salvar como PDF")
// ---------------------------------------------------------------------------
export async function textoDoPDF(arquivo) {
  const pdfjs = await import(LIBS.pdfjs);
  pdfjs.GlobalWorkerOptions.workerSrc = LIBS.pdfjsWorker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
  const linhas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const conteudo = await (await doc.getPage(p)).getTextContent();
    let atual = '';
    for (const it of conteudo.items) {
      atual += it.str;
      if (it.hasEOL) { if (atual.trim()) linhas.push(atual.trim()); atual = ''; }
    }
    if (atual.trim()) linhas.push(atual.trim());
  }
  return linhas;
}

/**
 * Interpreta as linhas de texto da página da NFC-e (formato da SEFAZ).
 * Retorna { loja, cnpj, data, numero, serie, chave, itens, soma, valorPago, desconto }.
 */
export function interpretarPaginaNFCe(linhasOriginais) {
  // O rótulo "Vl. Total" fica na coluna da direita e, no PDF, pode cair no
  // meio do nome ou do código. Removemos o rótulo e usamos qtd × valor unitário.
  const linhas = linhasOriginais
    .map(l => l.replace(/Vl\.\s*Total/gi, ' ').replace(/\s+/g, ' ').trim())
    .filter(l => l && !/^(Vl\.|Total)$/i.test(l));

  // Texto corrido com o início de cada linha registrado
  let S = '';
  const inicios = [];
  for (const l of linhas) { inicios.push(S.length); S += l + ' '; }
  const linhaEm = pos => { let k = 0; while (k + 1 < inicios.length && inicios[k + 1] <= pos) k++; return k; };

  // (Código: X) [lixo de quebra de página] Qtde.:Q UN: U Vl. Unit.: VU [VT]
  const re = /\(\s*C[óo]d(?:igo)?\.?:\s*([^)]*?)\s*\)\s*((?:(?!\(\s*C[óo]d).){0,300}?)Qtde\.?:\s*([\d.,]+)\s*UN:\s*(\S+)\s*Vl\.\s*Unit\.?:\s*([\d.,]+)(?:\s+([\d.]+,\d{2})(?!\d))?/gi;
  const itens = [];
  let m, fimAnterior = null;
  // Fim do cabeçalho: última linha de endereço (termina com a UF) depois do CNPJ
  const iCnpj = linhas.findIndex(l => /CNPJ/i.test(l));
  while ((m = re.exec(S))) {
    let inicioNome = fimAnterior;
    if (inicioNome == null) {
      const li = linhaEm(m.index);
      let k = li - 1;
      while (k > iCnpj && k >= 0 && !/,\s*[A-Z]{2}\s*$/.test(linhas[k]) && li - k <= 3) k--;
      inicioNome = inicios[k + 1] ?? 0;
    }
    const nome = S.slice(inicioNome, m.index).replace(/\s+/g, ' ')
      .replace(/^(?:[\d.]+,\d{2}\s+)+/, '').trim();
    const qtd = numero(m[3]);
    const vUnit = parseValor(m[5]);
    const calculado = Math.round(qtd * vUnit);
    const impresso = m[6] ? parseValor(m[6]) : NaN;
    itens.push({
      nome: nome || `Item ${itens.length + 1}`, codigo: m[1], qtd, un: m[4], vUnit,
      valor: Math.abs(impresso - calculado) <= 1 ? impresso : calculado
    });
    fimAnterior = m.index + m[0].length;
  }

  const txt = linhas.join('\n');
  const loja = (() => { const i = iCnpj; return i > 0 ? linhas[i - 1] : ''; })();
  const cnpj = (txt.match(/CNPJ:?\s*([\d./-]{14,18})/i) || [])[1] || '';
  const em = txt.match(/Emiss[ãa]o:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  const num = txt.match(/N[úu]mero:\s*(\d+)/i);
  const serie = txt.match(/S[ée]rie:\s*(\d+)/i);
  const chaveM = txt.replace(/(\d)\s+(?=\d)/g, '$1').match(/\d{44}/);
  const soma = itens.reduce((t, i) => t + i.valor, 0);

  // Valor pago: os totais da página costumam sair no início do texto, na ordem
  // [qtd itens, (valor total, descontos), valor a pagar, "Valor pago R$:", ...]
  let valorPago = NaN;
  const iPago = linhas.findIndex(l => /^Valor pago R\$:?$/i.test(l));
  if (iPago > 0 && /^[\d.]+,\d{2}$/.test(linhas[iPago - 1])) valorPago = parseValor(linhas[iPago - 1]);
  const mPagar = txt.match(/Valor a pagar R\$:?\s*([\d.]+,\d{2})/i);
  if (Number.isNaN(valorPago) && mPagar) valorPago = parseValor(mPagar[1]);
  const desconto = valorPago > 0 && valorPago < soma ? soma - valorPago : 0;

  return {
    origem: 'pdf', loja, cnpj, data: em ? `${em[3]}-${em[2]}-${em[1]}` : '', numero: num?.[1] || '',
    serie: serie?.[1] || '', chave: chaveM ? chaveM[0] : '', itens: distribuirDesconto(itens, desconto),
    soma, valorPago: Number.isNaN(valorPago) ? null : valorPago, desconto
  };
}

// ---------------------------------------------------------------------------
// Foto do cupom (OCR)
// ---------------------------------------------------------------------------
function carregarImagem(arquivo) {
  return new Promise((ok, erro) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); erro(new Error('Não foi possível abrir a imagem.')); };
    img.src = url;
  });
}

/** Desenha a imagem num canvas com a largura pedida (aumenta fotos pequenas, ex.: do WhatsApp). */
function canvasDe(img, largura, podeAumentar = false) {
  const esc = podeAumentar ? largura / img.naturalWidth : Math.min(1, largura / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * esc);
  c.height = Math.round(img.naturalHeight * esc);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function tonsDeCinza(canvas) {
  const ctx = canvas.getContext('2d');
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = (d.data[i] * 299 + d.data[i + 1] * 587 + d.data[i + 2] * 114) / 1000;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return canvas;
}

/** Tons de cinza + limiar adaptativo (corrige sombra e papel térmico desbotado). */
function binarizar(canvas, C = 20, divisor = 20) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const g = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) g[p] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  const integ = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let s = 0;
    for (let x = 1; x <= w; x++) { s += g[(y - 1) * w + x - 1]; integ[y * (w + 1) + x] = integ[(y - 1) * (w + 1) + x] + s; }
  }
  const r = Math.max(8, Math.round(w / divisor));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const soma = integ[y1 * (w + 1) + x1] - integ[y0 * (w + 1) + x1] - integ[y1 * (w + 1) + x0] + integ[y0 * (w + 1) + x0];
      const media = soma / ((x1 - x0) * (y1 - y0));
      const v = g[y * w + x] < media - C ? 0 : 255;
      const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Lê o QR code da foto (se houver) para obter a chave de acesso. */
export async function lerQRDaImagem(img) {
  const c = canvasDe(img, 1400);
  try {
    if ('BarcodeDetector' in window) {
      const det = new window.BarcodeDetector({ formats: ['qr_code'] });
      const r = await det.detect(c);
      if (r[0]?.rawValue) return r[0].rawValue;
    }
  } catch { /* segue para o jsQR */ }
  try {
    const jsQR = await carregarScript(LIBS.jsqr, 'jsQR');
    const tentativas = [[1400, false], [900, true], [1600, true], [1200, true], [2000, true]];
    for (const [larg, aumentar] of tentativas) {
      const cc = canvasDe(img, larg, aumentar);
      const dados = cc.getContext('2d').getImageData(0, 0, cc.width, cc.height);
      const r = jsQR(dados.data, cc.width, cc.height, { inversionAttempts: 'attemptBoth' });
      if (r?.data) return r.data;
    }
  } catch { /* sem QR */ }
  return null;
}

/** Comprime a foto para guardar como anexo (JPEG em tons de cinza). */
export async function fotoParaAnexo(arquivo, larguraMax = 1100, qualidade = 0.6) {
  const img = await carregarImagem(arquivo);
  const c = canvasDe(img, larguraMax);
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = (d.data[i] * 299 + d.data[i + 1] * 587 + d.data[i + 2] * 114) / 1000;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return c.toDataURL('image/jpeg', qualidade);
}

/** Faz o OCR da foto. Tenta duas preparações da imagem e fica com a que fecha com o total. */
export async function lerFoto(arquivo, aoProgredir = () => {}) {
  const img = await carregarImagem(arquivo);
  aoProgredir('Procurando o QR code…', 0.02);
  const qr = await lerQRDaImagem(img);
  aoProgredir('Baixando o leitor de texto (só na primeira vez)…', 0.06);
  const Tesseract = await carregarScript(LIBS.tesseract, 'Tesseract');
  let etapa = 0;
  const variantes = [
    () => tonsDeCinza(canvasDe(img, 2000, true)),
    () => binarizar(canvasDe(img, 2000, true), 20, 20)
  ];
  const worker = await Tesseract.createWorker('por', 1, {
    logger: m => {
      if (m.status === 'recognizing text') aoProgredir(etapa ? 'Conferindo a leitura…' : 'Lendo o cupom…', 0.1 + 0.45 * (etapa + m.progress));
    }
  });
  let melhor = null;
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    for (etapa = 0; etapa < variantes.length; etapa++) {
      const { data } = await worker.recognize(variantes[etapa]());
      const nota = interpretarCupomOCR(data.text, qr);
      nota.textoOCR = data.text;
      if (nota.confere) return nota;
      if (!melhor || pontuar(nota) > pontuar(melhor)) melhor = nota;
    }
    return melhor;
  } finally {
    worker.terminate();
  }
}
const pontuar = n => n.itens.length * 10 - n.itens.filter(i => i.conferir).length * 3
  - (n.valorPago != null ? Math.min(10, Math.abs(n.valorPago - n.soma) / 100) : 5);

/**
 * Interpreta o texto lido da foto de um cupom (DANFE NFC-e impresso).
 * É tolerante a erros: confere quantidade × valor unitário e marca itens duvidosos.
 */
export function interpretarCupomOCR(texto, qr = null) {
  const linhas = texto.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const valorRe = /(\d{1,3}(?:\.\d{3})*[,.]\d{2})(?!\d)/g;
  const paraCent = s => parseValor(s.replace(/\.(\d{2})$/, ',$1'));
  const fimItens = /QT[DU0O]\.?\s*TOTAL|TOTAL\s*D[EO]\s*ITENS|VAL[OU0]R\s*TOTAL|[AÀÁ]\s*PAGAR|FORMA\s*DE\s*PAG/i;
  const inicioItens = /C[OÓ]DIGO|DESCRI[CÇ][AÃ]O|QTDE?\s*UN/i;

  let dentro = false;
  const itens = [];
  for (const l of linhas) {
    if (!dentro) { if (inicioItens.test(l)) dentro = true; continue; }
    if (fimItens.test(l)) break;
    const valores = [...l.matchAll(valorRe)].map(x => x[1]);
    // quantidade, unidade e "x valor unitário"
    const qu = l.match(/(\d+(?:[.,]\d{1,3})?)\s*([A-Z]{1,3})\s*[xX×*]\s*(\d{1,3}(?:\.\d{3})*[,.]\d{2})/);
    if (valores.length) {
      let nome = l;
      if (qu) nome = l.slice(0, l.indexOf(qu[0]));
      else nome = l.slice(0, l.lastIndexOf(valores[valores.length - 1]));
      // remove o código do produto no início (dígitos, às vezes lidos como O/Q/I)
      nome = limparNomeOCR(nome);
      const total = paraCent(valores[valores.length - 1]);
      let item = { nome, qtd: 1, un: '', vUnit: null, valor: total, conferir: false };
      if (qu) {
        const q = numero(qu[1].replace('.', ','));
        const vu = paraCent(qu[3]);
        item = { ...item, qtd: q, un: qu[2], vUnit: vu };
        const calc = Math.round(q * vu);
        if (Math.abs(calc - total) > 1) {
          // um dos dois foi lido errado: fica com o cálculo e pede conferência
          item.valor = calc; item.conferir = true;
        }
      } else if (valores.length < 1) item.conferir = true;
      itens.push(item);
    } else if (itens.length && !/^[\W\d]+$/.test(l)) {
      // continuação do nome na linha seguinte
      itens[itens.length - 1].nome = (itens[itens.length - 1].nome + ' ' + l.replace(/[|]/g, '')).replace(/\s+/g, ' ').trim();
    }
  }

  const tudo = linhas.join('\n');
  const achar = re => { const m = tudo.match(re); return m ? paraCent(m[1]) : NaN; };
  const valorPagar = achar(/[AÀÁ]\s*PAGAR\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*[,.]\d{2})/i);
  const valorTotal = achar(/VALOR\s*TOTAL\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*[,.]\d{2})/i);
  const descontoLido = achar(/DESCONTOS?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*[,.]\d{2})/i);
  const soma = itens.reduce((t, i) => t + i.valor, 0);
  const valorPago = !Number.isNaN(valorPagar) ? valorPagar : (!Number.isNaN(valorTotal) ? valorTotal : null);
  let desconto = 0;
  if (descontoLido > 0 && valorPago != null && Math.abs(soma - descontoLido - valorPago) <= 2) desconto = descontoLido;

  // Se a soma fecha com o total da nota, as correções feitas (qtd × unitário) estão validadas
  const confere = valorPago != null && Math.abs(soma - desconto - valorPago) <= 1 && itens.length > 0;
  if (confere) itens.forEach(i => { i.conferir = false; });

  const cnpj = (tudo.match(/CNPJ:?\s*([\d.\/-]{14,18})/i) || [])[1] || '';
  // Linha do cabeçalho com o CNPJ (o rótulo "CNPJ" às vezes é mal lido)
  const linhaCnpj = linhas.find(l => /CNPJ/i.test(l)) || linhas.slice(0, 4).find(l => /\d{3,4}\s*[-–]\s*\d{2}/.test(l)) || '';
  const loja = linhaCnpj.replace(/^.*?\d{3,4}\s*[-–]\s*\d{2}\b\s*/, '').replace(/CNPJ:?/i, '').trim();
  const chave = chaveDoQR(qr) || (tudo.replace(/(\d)\s+(?=\d)/g, '$1').match(/\d{44}/) || [])[0] || '';
  const ch = lerChave(chave);
  // Data: confia no ano/mês da chave de acesso e pega o dia do texto
  const datas = [...tudo.matchAll(/(\d{2})\/(\d{2})\/(20\d{2})/g)];
  let data = '';
  const certa = ch ? datas.find(d => d[3] === ch.ano && d[2] === ch.mes) : datas[0];
  if (certa) data = `${certa[3]}-${certa[2]}-${certa[1]}`;
  else if (ch) {
    const dia = datas.find(d => d[2] === ch.mes)?.[1];
    if (dia) data = `${ch.ano}-${ch.mes}-${dia}`;
  }
  return {
    origem: 'foto', confere, loja, cnpj, data,
    numero: ch?.numero || '', serie: ch?.serie || '', chave,
    itens: distribuirDesconto(itens, desconto), soma, valorPago, desconto
  };
}

/** Remove o código do produto (muitas vezes mal lido) do início do nome. */
function limparNomeOCR(nome) {
  const t = nome.replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  while (t.length > 1) {
    const [a, b = ''] = t;
    const temDigitos = /\d{2,}/.test(a) || /^[0OQ]{3,}/.test(a);
    const lixoAntesDeCodigo = a.length <= 7 && /\d{3,}/.test(b);
    if (temDigitos || lixoAntesDeCodigo) t.shift(); else break;
  }
  return t.join(' ');
}

/** Lê um arquivo (PDF ou imagem) e devolve a nota interpretada. */
export async function lerNota(arquivo, aoProgredir = () => {}) {
  const ehPDF = arquivo.type === 'application/pdf' || /\.pdf$/i.test(arquivo.name);
  if (ehPDF) {
    aoProgredir('Lendo o PDF…', 0.3);
    const linhas = await textoDoPDF(arquivo);
    const nota = interpretarPaginaNFCe(linhas);
    if (!nota.itens.length) {
      throw new Error('Não encontrei itens neste PDF. Ele precisa ser o "Imprimir > Salvar como PDF" da página da SEFAZ aberta pelo QR code.');
    }
    return nota;
  }
  if (!/^image\//.test(arquivo.type) && !/\.(jpe?g|png|webp|heic)$/i.test(arquivo.name)) {
    throw new Error('Envie um PDF da SEFAZ ou uma foto do cupom.');
  }
  const nota = await lerFoto(arquivo, aoProgredir);
  if (!nota?.itens.length) throw new Error('Não consegui identificar os itens na foto. Tente uma foto mais nítida, com o cupom esticado e bem iluminado, ou use o PDF da SEFAZ.');
  return nota;
}
