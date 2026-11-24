# Gastos da Casa

App para celular que controla as compras da casa e calcula quanto cada morador deve aos outros.

- Cada item tem nome, valor, data, categoria, **quem pagou** e **com quem dividir** (1, 2 ou 3 pessoas). A divisão é em partes iguais.
- O app compensa as dívidas entre cada par de moradores. Exemplo: você paga uma TV de R$ 900 (R$ 300 para cada um) e o Maurício paga um micro-ondas de R$ 300 (R$ 100 para cada um). O app mostra **Maurício → você: R$ 200**.
- A opção **Simplificar** calcula o menor número de transferências possível.
- Na aba **Acertos** vocês registram os Pix entre moradores, e esses valores são descontados do que ainda está em aberto. O botão **Quitar** no Resumo já preenche o valor.
- Os dados ficam sincronizados entre os três celulares pelo Firebase. O app também funciona sem internet e envia as alterações quando a conexão volta.
- Na aba **Mensal** ficam as contas que se repetem todo mês (aluguel, luz, internet…), com dia de vencimento. Cada mês mostra o que está pago, o que vence em breve e o que está atrasado, inclusive de meses anteriores. Ao marcar uma conta como paga, o valor entra na divisão como um item comum.
- Em Ajustes dá para exportar uma planilha (CSV) e fazer backup ou restauração (JSON).

---

## Testar no computador (modo local)

Com o `config.js` ainda com `null`, o app roda em **modo local**, e os dados ficam só naquele navegador.

```bash
cd casa-gastos
python -m http.server 8000
# abra http://localhost:8000
```

> Abrir o `index.html` com dois cliques não funciona, porque os módulos JavaScript precisam de um servidor.

---

## Colocar para funcionar entre os três (cerca de 15 minutos, gratuito)

### 1. Criar o banco no Firebase

1. Acesse <https://console.firebase.google.com> e clique em **Criar projeto** (ex.: `gastos-da-casa`). O Google Analytics pode ficar desativado.
2. No menu, abra **Criação > Authentication > Vamos começar**. Na aba **Método de login**, ative **Anônimo**.
3. No menu, abra **Criação > Firestore Database > Criar banco de dados**. Escolha a região `southamerica-east1 (São Paulo)` e inicie em **modo de produção**.
4. Ainda no Firestore, abra a aba **Regras**, apague o conteúdo, cole o que está no arquivo `firestore.rules` e clique em **Publicar**.
5. Clique na engrenagem e vá em **Configurações do projeto**. Em **Seus apps**, clique no ícone **`</>`** (Web), dê um nome e registre. O Firebase Hosting não precisa ser marcado.
6. Copie o objeto `firebaseConfig` que aparece na tela.

### 2. Configurar o app

Abra o `config.js` e:

- substitua `null` pelo objeto copiado em `FIREBASE_CONFIG`;
- troque `CASA_ID` por um código difícil de adivinhar (ex.: `casa-lipe-mau-edu-7k3p`).

### 3. Publicar no GitHub Pages

1. Crie um repositório no GitHub (ex.: `gastos-da-casa`) e envie **todos os arquivos desta pasta**.
2. No repositório, abra **Settings > Pages**. Em *Source*, escolha **Deploy from a branch**, depois a branch `main` e a pasta `/ (root)`, e clique em **Save**.
3. Em 1 ou 2 minutos o app estará em `https://SEU-USUARIO.github.io/gastos-da-casa/`.

### 4. Instalar no celular

Mande o link para o Maurício e o Eduardo.

- **Android (Chrome):** menu ⋮ e depois **Instalar app** (ou *Adicionar à tela inicial*).
- **iPhone (Safari):** botão Compartilhar e depois **Adicionar à Tela de Início**.

Na primeira vez, quem abrir o app digita os nomes dos três. Nos outros celulares, o app só pergunta **"Quem é você?"**.

---

## Atualizar o app depois

Depois de alterar algum arquivo, aumente a versão em `sw.js` (`casa-gastos-v1` → `v2`) e envie de novo para o GitHub. Os celulares baixam a nova versão na próxima abertura (às vezes é preciso fechar e abrir de novo).

## Problemas comuns

| Sintoma | Solução |
|---|---|
| "Não foi possível conectar ao Firebase" | Confira o `config.js` e se o login **Anônimo** está ativado. |
| "Missing or insufficient permissions" | As regras do Firestore não foram publicadas (passo 1.4). |
| Os outros não veem meus itens | Todos precisam abrir o **mesmo link**, com o mesmo `CASA_ID`. |

## Sobre segurança

O `firebaseConfig` não é uma senha. É normal ele ficar no código de apps web. A proteção vem das regras do Firestore e do `CASA_ID`. Para uma casa entre amigos isso é suficiente. Se quiserem mais controle, dá para trocar o login anônimo por login com Google e liberar só os e-mails de vocês nas regras.

## Arquivos

| Arquivo | Função |
|---|---|
| `index.html` | Telas e estilo |
| `app.js` | Lógica da interface |
| `mensal.js` | Vencimentos e situação das contas mensais |
| `calculo.js` | Divisão, compensação entre pares e simplificação (valores em centavos) |
| `store.js` | Firebase Firestore ou armazenamento local |
| `config.js` | **Única coisa que você precisa editar** |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalação como app e funcionamento offline |
| `firestore.rules` | Regras de segurança para colar no Firebase |

Contato: [github.com/lipinskii](https://github.com/lipinskii)
