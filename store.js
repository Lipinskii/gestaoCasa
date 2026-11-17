// Camada de dados: Firebase Firestore (sincronizado) ou armazenamento local.
// Ambas expõem a mesma interface para o app.
import { FIREBASE_CONFIG, CASA_ID } from './config.js';

export async function criarStore() {
  if (FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey) return criarFirebaseStore();
  return criarLocalStore();
}

const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------------------------------------------------------------------------
// Firebase
// ---------------------------------------------------------------------------
async function criarFirebaseStore() {
  const V = '11.0.2';
  const base = `https://www.gstatic.com/firebasejs/${V}/`;
  const { initializeApp } = await import(base + 'firebase-app.js');
  const { getAuth, signInAnonymously } = await import(base + 'firebase-auth.js');
  const fs = await import(base + 'firebase-firestore.js');

  const app = initializeApp(FIREBASE_CONFIG);
  let db;
  try {
    // Cache local: o app abre e aceita lançamentos mesmo sem internet
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() })
    });
  } catch {
    db = fs.getFirestore(app);
  }
  // Reaproveita o login salvo (permite abrir offline); só faz login novo na 1ª vez
  const auth = getAuth(app);
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);

  const casaRef = fs.doc(db, 'casas', CASA_ID);
  const itensCol = fs.collection(casaRef, 'itens');
  const pagCol = fs.collection(casaRef, 'pagamentos');

  const limpar = obj => {
    const { id, ...resto } = obj;
    return resto;
  };

  return {
    tipo: 'firebase',
    casaId: CASA_ID,
    subscribe(cb, cbErro) {
      const estado = { pessoas: null, itens: [], pagamentos: [], pendente: false, offline: false };
      const prontos = { casa: false, itens: false, pag: false };
      const pend = { itens: false, pag: false };
      const emitir = () => {
        estado.pendente = pend.itens || pend.pag;
        if (prontos.casa && prontos.itens && prontos.pag) cb({ ...estado });
      };
      const opts = { includeMetadataChanges: true };
      fs.onSnapshot(casaRef, opts, snap => {
        estado.pessoas = snap.exists() ? (snap.data().pessoas || null) : null;
        estado.offline = snap.metadata.fromCache;
        prontos.casa = true; emitir();
      }, cbErro);
      fs.onSnapshot(itensCol, opts, snap => {
        estado.itens = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        pend.itens = snap.metadata.hasPendingWrites;
        prontos.itens = true; emitir();
      }, cbErro);
      fs.onSnapshot(pagCol, opts, snap => {
        estado.pagamentos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        pend.pag = snap.metadata.hasPendingWrites;
        prontos.pag = true; emitir();
      }, cbErro);
    },
    // As escritas não são aguardadas: o Firestore atualiza a tela na hora
    // e envia ao servidor quando houver conexão.
    salvarPessoas: pessoas => fs.setDoc(casaRef, { pessoas }, { merge: true }),
    salvarItem: item => item.id
      ? fs.setDoc(fs.doc(itensCol, item.id), limpar(item))
      : fs.setDoc(fs.doc(itensCol, novoId()), limpar(item)),
    excluirItem: id => fs.deleteDoc(fs.doc(itensCol, id)),
    salvarPagamento: pg => fs.setDoc(fs.doc(pagCol, pg.id || novoId()), limpar(pg)),
    excluirPagamento: id => fs.deleteDoc(fs.doc(pagCol, id)),
    async importar(dados) {
      const lote = fs.writeBatch(db);
      if (dados.pessoas) lote.set(casaRef, { pessoas: dados.pessoas }, { merge: true });
      for (const it of dados.itens || []) lote.set(fs.doc(itensCol, it.id || novoId()), limpar(it));
      for (const pg of dados.pagamentos || []) lote.set(fs.doc(pagCol, pg.id || novoId()), limpar(pg));
      return lote.commit();
    }
  };
}

// ---------------------------------------------------------------------------
// Local (só neste aparelho)
// ---------------------------------------------------------------------------
function criarLocalStore() {
  const CHAVE = 'casa-gastos-dados-v1';
  let estado = { pessoas: null, itens: [], pagamentos: [] };
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (salvo) estado = { ...estado, ...JSON.parse(salvo) };
  } catch { /* sem armazenamento: fica só em memória */ }

  let ouvinte = () => {};
  const persistir = () => {
    try { localStorage.setItem(CHAVE, JSON.stringify(estado)); } catch { /* ignora */ }
    ouvinte({ ...estado, pendente: false, offline: false });
    return Promise.resolve();
  };
  const upsert = (lista, obj) => {
    const id = obj.id || novoId();
    const i = estado[lista].findIndex(x => x.id === id);
    if (i >= 0) estado[lista][i] = { ...obj, id };
    else estado[lista].push({ ...obj, id });
  };

  return {
    tipo: 'local',
    casaId: null,
    subscribe(cb) { ouvinte = cb; persistir(); },
    salvarPessoas(pessoas) { estado.pessoas = pessoas; return persistir(); },
    salvarItem(item) { upsert('itens', item); return persistir(); },
    excluirItem(id) { estado.itens = estado.itens.filter(x => x.id !== id); return persistir(); },
    salvarPagamento(pg) { upsert('pagamentos', pg); return persistir(); },
    excluirPagamento(id) { estado.pagamentos = estado.pagamentos.filter(x => x.id !== id); return persistir(); },
    importar(dados) {
      if (dados.pessoas) estado.pessoas = dados.pessoas;
      for (const it of dados.itens || []) upsert('itens', it);
      for (const pg of dados.pagamentos || []) upsert('pagamentos', pg);
      return persistir();
    }
  };
}
