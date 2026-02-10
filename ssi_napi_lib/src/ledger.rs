use indy_vdr::pool::{PoolBuilder, PoolRunner, PoolTransactions, RequestResult};
use indy_vdr::config::PoolConfig;
use indy_vdr::ledger::RequestBuilder;
use indy_vdr::utils::did::DidValue;
use tokio::sync::oneshot; 

/// Conecta ao Pool usando o arquivo genesis
pub fn connect_pool(genesis_path: &str) -> Result<Box<PoolRunner>, String> {
    let config = PoolConfig::default();
    
    let transactions = PoolTransactions::from_json_file(genesis_path)
        .map_err(|e| format!("Erro lendo genesis: {}", e))?;

    let pool_builder = PoolBuilder::new(config, transactions);

    // CORREÇÃO: Adicionado 'None' (cache opcional)
    let pool_runner = pool_builder.into_runner(None)
        .map_err(|e| format!("Erro criando runner: {}", e))?;

    Ok(Box::new(pool_runner))
}

/// Resolve (Lê) um DID no Ledger
pub async fn get_nym(pool: &PoolRunner, did_to_fetch: &str) -> Result<String, String> {
    // CORREÇÃO: Usamos DidValue::new em vez de from_str
    let target_did = DidValue::new(did_to_fetch, None);

    let builder = RequestBuilder::default();
    
    let request = builder.build_get_nym_request(
        None,           
        &target_did,    
        None,           
        None            
    ).map_err(|e| format!("Erro request builder: {}", e))?;

    // Canal para transformar Callback em Async/Await
    let (tx, rx) = oneshot::channel();

    // CORREÇÃO: Removemos o '&' antes de request. A função consome o objeto.
    pool.send_request(
        request, 
        Box::new(move |result| {
            let _ = tx.send(result);
        })
    ).map_err(|e| format!("Erro enviando ao pool: {}", e))?;

    let (result, _timing) = rx.await
        .map_err(|_| "Erro: O Callback do Pool foi perdido".to_string())?
        .map_err(|e| format!("Erro retornado pelo VDR: {}", e))?;

    match result {
        RequestResult::Reply(body) => Ok(body),
        RequestResult::Failed(e) => Err(format!("Falha na requisição: {:?}", e)),
    }
}