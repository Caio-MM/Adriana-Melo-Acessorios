/**
 * =============================================================================
 *  NOTA FISCAL AUTOMÁTICA — Focus NFe
 * =============================================================================
 *  Emite a NF-e (modelo 55) de um pedido pago, chamada pelo webhook do
 *  Mercado Pago (server.js, runApprovedOrderSideEffects), do mesmo jeito e
 *  no mesmo lugar que a compra automática da etiqueta de envio e os avisos
 *  de WhatsApp/e-mail — best-effort, nunca pode reverter a confirmação do
 *  pedido, que já foi gravada antes de chegar aqui.
 *
 *  Usa a API REST da Focus NFe (https://focusnfe.com.br) via fetch nativo —
 *  mesma abordagem "sem SDK" já usada para Melhor Envio/WhatsApp. Troque
 *  emitirNotaFiscal() por outro emissor (eNotas, NFe.io) se preferir; é a
 *  única função pensada para ser chamada de fora.
 *
 *  🔑 Credenciais e dados fiscais (ver server/.env.example, bloco NOTA
 *  FISCAL). Reaproveita os dados do remetente já usados para a etiqueta de
 *  envio (SELLER_*, ORIGIN_CEP) — mesmo endereço, dois usos.
 *
 *  ⚠️ Emitir NF-e exige uma conta na Focus NFe com certificado digital
 *  configurado — isso é uma exigência da Receita, não deste código, e só a
 *  lojista pode resolver (abrir a conta, confirmar com o contador o regime
 *  tributário e os códigos fiscais). Enquanto FOCUS_NFE_TOKEN e os dados
 *  fiscais não estiverem preenchidos, emitirNotaFiscal() nem tenta —
 *  configuracaoCompleta() abaixo é a guarda.
 *
 *  ⚠️ Os códigos fiscais de cada item (ICMS, PIS/COFINS) dependem do
 *  regime tributário da empresa — só o contador confirma os certos. Saem
 *  inteiramente de variáveis de ambiente (NFE_ICMS_SITUACAO_TRIBUTARIA,
 *  NFE_PIS_COFINS_SITUACAO); este arquivo não tenta adivinhar um valor.
 *
 *  ⚠️ Nunca testado contra a API de verdade (a conta ainda não existe). Os
 *  nomes de campo do corpo da requisição foram conferidos contra um
 *  exemplo real da documentação da Focus NFe (focusnfe.com.br/js); o
 *  endpoint de CONSULTA (GET /v2/nfe/{ref}) segue o mesmo padrão dos
 *  outros recursos da API, mas não apareceu num exemplo — confirme em
 *  doc.focusnfe.com.br/reference/nfe assim que a conta existir, testando
 *  primeiro em homologação (NFE_AMBIENTE=homologacao, o padrão).
 * =============================================================================
 */

const NFE_HOST = {
  homologacao: "https://homologacao.focusnfe.com.br",
  producao: "https://api.focusnfe.com.br",
};

function ambiente() {
  return process.env.NFE_AMBIENTE === "producao" ? "producao" : "homologacao";
}
function baseUrl() {
  return NFE_HOST[ambiente()];
}

function configuracaoCompleta() {
  return Boolean(
    process.env.FOCUS_NFE_TOKEN &&
    process.env.NFE_CNPJ &&
    process.env.NFE_RAZAO_SOCIAL &&
    process.env.NFE_ICMS_SITUACAO_TRIBUTARIA &&
    process.env.SELLER_ADDRESS &&
    process.env.SELLER_CITY &&
    process.env.SELLER_STATE &&
    process.env.ORIGIN_CEP
  );
}

function authHeader() {
  return "Basic " + Buffer.from(`${process.env.FOCUS_NFE_TOKEN}:`).toString("base64");
}

/* ⚠️ 5101/6101 são os CFOP de "venda de produção do próprio
   estabelecimento" — certos para quem FABRICA o que vende, o caso dela.
   Uma revenda usaria 5102/6102. Configurável para o dia em que isso
   deixar de valer (linha nova de produtos comprados prontos, por
   exemplo). */
function cfopPara(ufDestino) {
  const dentro = process.env.NFE_CFOP_DENTRO_ESTADO || "5101";
  const fora = process.env.NFE_CFOP_FORA_ESTADO || "6101";
  const ufEmitente = String(process.env.SELLER_STATE || "").toUpperCase();
  return String(ufDestino || "").toUpperCase() === ufEmitente ? dentro : fora;
}

function digitos(v) {
  return String(v || "").replace(/\D/g, "");
}
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function montarPayload({ referencia, items, address, subtotal, shippingPrice, discountTotal, total }) {
  const semNcm = items.find(item => !item.ncm);
  if (semNcm) {
    throw new Error(`"${semNcm.name}" não tem NCM cadastrado — preencha no painel (Produtos) antes de emitir a nota.`);
  }

  const agora = new Date().toISOString().slice(0, 19);
  const cfop = cfopPara(address.uf);

  return {
    natureza_operacao: "Venda",
    data_emissao: agora,
    data_entrada_saida: agora,
    tipo_documento: "1",
    finalidade_emissao: "1",
    modalidade_frete: "0",

    cnpj_emitente: digitos(process.env.NFE_CNPJ),
    nome_emitente: process.env.NFE_RAZAO_SOCIAL,
    nome_fantasia_emitente: process.env.NFE_NOME_FANTASIA || process.env.NFE_RAZAO_SOCIAL,
    logradouro_emitente: process.env.SELLER_ADDRESS,
    numero_emitente: process.env.SELLER_NUMBER,
    complemento_emitente: process.env.SELLER_COMPLEMENT || undefined,
    bairro_emitente: process.env.SELLER_DISTRICT,
    municipio_emitente: process.env.SELLER_CITY,
    uf_emitente: process.env.SELLER_STATE,
    cep_emitente: digitos(process.env.ORIGIN_CEP),
    inscricao_estadual_emitente: process.env.NFE_INSCRICAO_ESTADUAL || "ISENTO",

    nome_destinatario: address.nome,
    cpf_destinatario: digitos(address.cpf),
    telefone_destinatario: digitos(address.telefone),
    logradouro_destinatario: address.rua,
    numero_destinatario: address.numero,
    complemento_destinatario: address.complemento || undefined,
    bairro_destinatario: address.bairro,
    municipio_destinatario: address.cidade,
    uf_destinatario: address.uf,
    pais_destinatario: "Brasil",
    cep_destinatario: digitos(address.cep),

    valor_frete: String(round2(shippingPrice)),
    valor_seguro: "0",
    valor_desconto: String(round2(discountTotal)),
    valor_produtos: String(round2(subtotal)),
    valor_total: String(round2(total)),

    items: items.map((item, i) => ({
      numero_item: String(i + 1),
      codigo_produto: String(item.id),
      descricao: item.name,
      codigo_ncm: item.ncm,
      cfop,
      unidade_comercial: "UN",
      quantidade_comercial: String(item.qty),
      valor_unitario_comercial: String(item.price),
      unidade_tributavel: "UN",
      quantidade_tributavel: String(item.qty),
      valor_unitario_tributavel: String(item.price),
      valor_bruto: String(round2(item.qty * item.price)),
      icms_origem: "0",
      icms_situacao_tributaria: process.env.NFE_ICMS_SITUACAO_TRIBUTARIA,
      pis_situacao_tributaria: process.env.NFE_PIS_COFINS_SITUACAO || "07",
      cofins_situacao_tributaria: process.env.NFE_PIS_COFINS_SITUACAO || "07",
    })),
  };
}

async function chamarFocusNfe(method, path, body) {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "Authorization": authHeader() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { httpStatus: res.status, data };
}

function espera(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const STATUS_EM_PROCESSAMENTO = "processando_autorizacao";

async function aguardarResultado(referencia, { tentativas = 5, intervaloMs = 2500 } = {}) {
  for (let i = 0; i < tentativas; i++) {
    await espera(intervaloMs);
    const { data } = await chamarFocusNfe("GET", `/v2/nfe/${encodeURIComponent(referencia)}`);
    if (data && data.status && data.status !== STATUS_EM_PROCESSAMENTO) return data;
  }
  return null; // ainda processando depois de todas as tentativas — não é erro
}

function resolverResultado(data) {
  if (!data) {
    return { status: "processando", number: null, url: null, error: null };
  }
  if (data.status === "autorizado") {
    return {
      status: "emitida",
      number: data.numero || null,
      url: data.caminho_danfe ? `${baseUrl()}${data.caminho_danfe}` : null,
      error: null,
    };
  }
  return {
    status: "erro",
    number: null,
    url: null,
    error: data.mensagem_sefaz || data.mensagem || data.erro || `Focus NFe: status ${data.status || "desconhecido"}`,
  };
}

/**
 * Ponto de entrada. `order` já vem RESOLVIDO por quem chama (server.js) —
 * nome/NCM de cada item, endereço — do mesmo jeito que notifyOwnerOfPaidOrder
 * (lib/whatsapp.js, lib/email.js) recebe. Propaga erro (não engole); quem
 * chama decide como logar/isolar a falha, mesmo padrão de purchaseShippingLabel.
 */
async function emitirNotaFiscal({ externalReference, items, address, subtotal, shippingPrice, discountTotal, total }) {
  if (!configuracaoCompleta()) {
    throw new Error("Nota fiscal não configurada (FOCUS_NFE_TOKEN e os dados fiscais no .env) — nota não emitida.");
  }
  const referencia = String(externalReference).replace(/[^a-zA-Z0-9]/g, "").slice(0, 50);
  const payload = montarPayload({ referencia, items, address, subtotal, shippingPrice, discountTotal, total });

  const { httpStatus, data } = await chamarFocusNfe("POST", `/v2/nfe?ref=${encodeURIComponent(referencia)}`, payload);
  if (httpStatus >= 400) {
    throw new Error(data?.mensagem || data?.erro || `Focus NFe respondeu ${httpStatus} ao emitir a nota.`);
  }

  const resolvido = (data && data.status && data.status !== STATUS_EM_PROCESSAMENTO)
    ? data
    : await aguardarResultado(referencia);

  return { referencia, ...resolverResultado(resolvido) };
}

module.exports = {
  configuracaoCompleta,
  ambiente,
  cfopPara,
  montarPayload,
  emitirNotaFiscal,
};
