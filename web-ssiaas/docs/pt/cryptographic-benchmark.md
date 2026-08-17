# Benchmark de Criptografia Pós-Quântica (SSI-PQ)

## Visão Geral
Este repositório (`lib/`) contém um conjunto de ferramentas para mensurar o desempenho (tempos de execução, uso de recursos da máquina) e o impacto em armazenamento (tamanho dos artefatos) das operações criptográficas pós-quânticas integradas na biblioteca `ssi_pq_core.node`.

Os algoritmos avaliados incluem:
- **ML-KEM (Kyber):** Para encapsulamento de chaves e estabelecimento de segredo compartilhado.
- **ML-DSA (Dilithium):** Para emissão e verificação de assinaturas digitais nas credenciais.

## Ferramentas de Benchmark Disponíveis

### 1. Métricas Gerais (`lib/metrics-benchmark.js`)
Mede o tempo médio e o overhead genérico do ciclo de vida completo da credencial (geração de chaves, schema, assinatura, geração de PDF, criptografia e decapsulamento).

```bash
WARMUP_ITERATIONS=5 ITERATIONS=100 THREADS=10 node lib/metrics-benchmark.js
```
- **Saída:** `lib/metrics_output/metrics-report.html`

### 2. Stress Test de Verificação (`lib/verify-benchmark.js`)
Realiza um teste de stress massivo (simulando alta carga de servidor) focado unicamente na **verificação de PDFs assinados**. Mede o *throughput* (verificações por segundo) dividindo as iterações pelas threads ativas. Inclui monitoramento ativo de consumo de RAM e uso percentual de cada núcleo lógico da CPU.

```bash
WARMUP_ITERATIONS=10 ITERATIONS=1000 THREADS=12 node lib/verify-benchmark.js
```
- **Saída:** `lib/metrics_output/metrics-verify-report.html`

### 3. Escalabilidade de Tamanhos (`lib/size-benchmark.js`)
Analisa o overhead na estrutura de dados (Schema, Credencial Assinada, PDF Visual e PDF Cifrado) avaliando como esses artefatos crescem em bytes conforme o tamanho do atributo original (payload) da credencial aumenta de **1 KB até 1 MB**. (Execução sequencial sem uso de variáveis de ambiente).

```bash
node lib/size-benchmark.js
```
- **Saída:** `lib/metrics_output/size-benchmark-report.html`

## Variáveis de Ambiente Globais
As ferramentas de performance (`metrics-benchmark` e `verify-benchmark`) suportam a definição de parâmetros de ambiente:

- `ITERATIONS` (padrão: 10): Define o número de iterações totais cujas métricas serão coletadas. No teste de verificação, esse número total é dividido e processado de forma distribuída pelas threads.
- `WARMUP_ITERATIONS` (padrão: 0): Define o número de iterações de aquecimento (descartadas) executadas em cada thread antes da coleta de dados. É altamente recomendado usar ao menos `5` para garantir que a CPU/cache estejam alocados.
- `THREADS` (padrão: 1): Define a quantidade de threads simultâneas lançadas via `node:worker_threads`. Para extrair o throughput máximo, sugere-se não ultrapassar o número de núcleos físicos da máquina hospedeira.
