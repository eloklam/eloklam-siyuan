
const calls = [];
let renderView = {};
exports.__setRenderView = (view) => { renderView = view; };
exports.fetchSyncPost = async (url, body) => {
  if (url === "/api/av/renderAttributeView") {
    return {code: 0, data: {view: renderView}};
  }
  const tx = body.transactions[0];
  calls.push({doOperations: tx.doOperations, undoOperations: tx.undoOperations});
  return {code: 0, data: [{doOperations: tx.doOperations}]};
};
exports.__calendarTransactionCalls = calls;
