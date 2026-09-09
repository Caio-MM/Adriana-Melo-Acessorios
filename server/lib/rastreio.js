"use strict";

const CODIGO_CORREIOS_REGEX = /^[A-Z]{2}\d{9}BR$/;

/* ⚠️ Não é API pública com contrato: é o mesmo endereço que o site dos
   Correios usa na própria página de rastreio, sem autenticação. Pode mudar
   de formato ou parar de responder sem aviso, então tudo aqui é best-effort
   e qualquer falha devolve null. */
async function consultarCorreios(trackingCode){
  if(!trackingCode || !CODIGO_CORREIOS_REGEX.test(trackingCode)) return null;
  try{
    const res = await fetch(`https://proxyapp.correios.com.br/v1/sro-rastro/${encodeURIComponent(trackingCode)}`, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if(!res.ok) return null;
    const data = await res.json();
    const objeto = Array.isArray(data?.objetos) ? data.objetos[0] : (Array.isArray(data) ? data[0] : data);
    const rawEventos = objeto?.eventos || objeto?.tracking_events || objeto?.events || null;
    if(!Array.isArray(rawEventos)) return null;
    const events = rawEventos.map(ev => {
      if(!ev || typeof ev !== "object") return null;
      const description = ev.descricao || ev.description || ev.message || null;
      const date = ev.dtHrCriado || ev.data || ev.date || ev.created_at || null;
      const unidade = ev.unidade || {};
      const location = (unidade.cidade && unidade.uf) ? `${unidade.cidade}/${unidade.uf}` : (ev.local || ev.location || null);
      if(!description && !date) return null;
      return { description, date, location: location || null };
    }).filter(Boolean);
    if(events.length === 0) return null;
    return { status: events[0].description, events };
  }catch(err){
    console.error(`Não foi possível consultar rastreio direto dos Correios (${trackingCode}):`, err.message || err);
    return null;
  }
}

/* ⚠️ "entregue ao remetente" é DEVOLUÇÃO, não entrega — marcar isso como
   entregue diria à cliente que o pacote chegou quando ele voltou. */
function eventoDeEntrega(events){
  if(!Array.isArray(events)) return null;
  return events.find(ev => {
    const texto = String(ev?.description || "").toLowerCase();
    return texto.includes("entregue") && !texto.includes("remetente");
  }) || null;
}

function dataDoEvento(evento){
  if(!evento?.date) return null;
  const d = new Date(evento.date);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function linkDaTransportadora(trackingCode){
  if(!trackingCode) return null;
  return CODIGO_CORREIOS_REGEX.test(trackingCode)
    ? `https://rastreamento.correios.com.br/app/index.php?objetos=${encodeURIComponent(trackingCode)}`
    : `https://www.melhorenvio.com.br/rastreio/${encodeURIComponent(trackingCode)}`;
}

module.exports = {
  CODIGO_CORREIOS_REGEX,
  consultarCorreios,
  eventoDeEntrega,
  dataDoEvento,
  linkDaTransportadora,
};
