# Benchmark de Criptografia Pós-Quântica (SSI-PQ)

## Visão Geral
Este documento descreve o uso do script de benchmark criptográfico localizado em `lib/metrics-benchmark.js`. O objetivo do script é mensurar o desempenho (tempos de execução) e o impacto em armazenamento (tamanho dos artefatos) das operações criptográficas pós-quânticas integradas na biblioteca `ssi_pq_core.node`.

Os algoritmos avaliados incluem:
- **ML-KEM (Kyber):** Para encapsulamento de chaves e estabelecimento de segredo compartilhado.
- **ML-DSA (Dilithium):** Para emissão e verificação de assinaturas digitais nas credenciais.

## Como Executar
O script suporta a definição de parâmetros através de variáveis de ambiente, permitindo configurações flexíveis de iterações, aquecimento (warmup) e multi-threading.

```bash
WARMUP_ITERATIONS=5 ITERATIONS=100 THREADS=10 node lib/metrics-benchmark.js
```

### Variáveis de Ambiente
- `ITERATIONS` (padrão: 10): Define o número de iterações cujas métricas serão coletadas e processadas para o cálculo de média e desvio padrão.
- `WARMUP_ITERATIONS` (padrão: 0): Define o número de iterações executadas antes da coleta de dados. É altamente recomendado usar ao menos `5` para garantir que a CPU/cache esteja aquecida, melhorando a precisão das medidas coletadas.
- `THREADS` (padrão: 1): Define a quantidade de threads simultâneas para acelerar a execução do teste utilizando a API `node:worker_threads`.

## Relatório Gerado
Após a conclusão bem-sucedida, o script gera um arquivo HTML estático (`lib/metrics-report.html`) contendo:
- **Informações da Máquina:** Processador, RAM e Sistema Operacional.
- **Tabela de Tempos de Execução (em ms):** Média e desvio padrão para funções como geração de schema, emissão de credencial, assinaturas, criptografia AES-256-GCM, verificação e decapsulamento. As métricas são separadas em perfis de segurança Nível 1 (128-bit), Nível 3 (192-bit) e Nível 5 (256-bit).
- **Tabela de Tamanhos (em KB):** Comparativo do tamanho original da credencial JSON versus a credencial assinada, o schema, e o PDF final encapsulado com ML-KEM/AES.
