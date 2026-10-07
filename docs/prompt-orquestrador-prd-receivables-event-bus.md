# Prompt — orquestrador: PRD técnico + 4 docs técnicos do Receivables v1 (event bus)

Você é um agente orquestrador rodando no Claude Code com o plugin **pattern-library** da ContaAzul ativo. Sua missão é produzir, pela esteira oficial e **de forma autônoma**, **1 PRD técnico de escopo reduzido** e **4 docs técnicos (fatias)** para o serviço `banking-cash-receivables`. Na v1, esse serviço funciona como **event bus temporário** entre as APIs do `payments` (legado) e o domínio financeiro.

O escopo cobre **só cinco jornadas de cobrança: emitir, cancelar, renegociar, expirar e baixar**.

**Parâmetros da execução** (preenchidos por quem dispara o orquestrador):
- `NEXUS_EPIC_KEY`: `<preencher ou deixar vazio>`
- `NEXUS_STORY_KEYS` (fatias 1–4): `<preencher ou deixar vazio>`

---

## 0. Regra de autonomia (vale acima de tudo)

**Não escale para o humano.** Toda informação e toda decisão necessária estão neste prompt e nas duas páginas da seção 1.

- **Quando uma skill da esteira fizer uma pergunta ou pedir confirmação num gate**, responda você mesmo:
  1. com a decisão correspondente da seção 4;
  2. se não houver decisão explícita, com a opção que respeita a hierarquia de fontes da seção 1 e o escopo da seção 3.

  Registre a resposta no resumo final.
- **O `/gerar-prd` é um guia interativo.** Responda às perguntas dele a partir deste prompt.
  - Para campos de métrica, hipótese ou decisão de negócio exigidos pelo template, use "não se aplica: PRD técnico de integração".
  - Não invente meta nem KPI.
- **Informação que não está no prompt nem nas fontes:**
  - não pare;
  - escreva a suposição no doc como `> **Premissa:**`, com a origem do raciocínio;
  - siga em frente;
  - liste a premissa no resumo final.
- **Divergência entre fontes:** aplique a hierarquia da seção 1, registre `> **Divergência:**` no doc com a escolha feita e siga.
- **Pendência de outro time:** registre como dependência com dono e siga. Pendência nunca bloqueia a geração do doc.
- **Limite de iterações** (spec review, revisar-doc-tecnico): ao atingir o máximo, registre o que ficou como `> **Pendência:**` no doc, emita o halt de telemetria previsto pela pattern-library e siga para o próximo artefato.
- **Publicação externa:**
  - Se `NEXUS_EPIC_KEY` estiver vazio, **não abra PR** e não publique em Notion ou Jira. Grave os arquivos no atlas numa branch local `docs/receivables-v1-event-bus`, faça commit local e registre no resumo que faltou a chave (guard T5).
  - Se a chave existir, abra os PRs com a chave no branch e no título.
- **Seed do atlas:** se `banking-cash-receivables` não estiver em `skills/gerar-prd/context/repo-mapping.yaml` nem em `deploy_repos:` do atlas, **grave o seed** mapeando para `banking-cash/receivable`. Está pré-autorizado. Registre no resumo.

---

## 1. Fontes

Leia as duas páginas com a ferramenta **Artifact, action `read`**. Não use WebFetch nem curl.

1. **Modelo de domínio-alvo:** fonte de verdade para nomes, agregados, VOs, comandos, eventos e regras de consistência. Use só a parte que toca as cinco jornadas.
   https://claude.ai/artifact/CeFDkxU4Yd9BUERG8UwYcv?sk=QuXUeUFhX0arY2NKzxbOfA
2. **Baixa com outbox e design da v1 do event bus:** integração, mapeamento SNS → Kafka e riscos.
   https://claude.ai/artifact/8TThrWxoDGMdhDLrUNPDf9

Repositórios locais (somente leitura):
- `/Users/tiago.santos/Desktop/ca-workspace/payments` (leia o `CLAUDE.md`), `payments-orchestrator`, `banking-orchestrator`, `receivables-architecture`, `docs-receivables`
- `/Users/tiago.santos/Desktop/ai-native/ca-starters-java` e `ca-starter-java-showcase`
- `/Users/tiago.santos/Desktop/ai-native/atlas` (subdomínio `banking-cash/receivable`)
- `/Users/tiago.santos/Desktop/ai-native/pattern-library`
- Serviço-alvo: `ContaAzul/banking-cash-receivables` e `ContaAzul/banking-cash-receivables-infra`. Os dois são templates vazios (Java 21, Spring Boot, parent `spring-ca-service-parent`).
- Contrato do Antifraude: PRs `ContaAzul/payments` #3942, #3943, #3947 e #3948 (NEXUS-4414), lidos com `gh pr view`/`gh pr diff`, somente leitura. Contém o envelope, o payload `InvoiceLifecycleEvent`, o `docs/asyncapi.json` e as actions.

**Hierarquia de fontes:**
1. Este prompt (seção 4, decisões fechadas).
2. O modelo de domínio-alvo (fonte 1).
3. A página da v1 (fonte 2).
4. O contrato do #3942.
5. O código atual.

Nunca unifique duas versões numa terceira.

---

## 2. Fluxo de execução

1. Invoque `pattern-library:using-pattern-library` e siga as regras de ownership e comunicação. Narre em PT-BR, um anúncio por fase, sem despejar saída crua de exploração.
2. **Pré-condições:** seed do atlas (seção 0) e leitura das fontes.
3. **PRD técnico:** rode `/gerar-prd` ("Receivables v1 — jornadas de cobrança via event bus"), com as 4 fatias aninhadas.
   - **Seções:**
     - problema técnico: o dual-write e o acoplamento com o payments;
     - escopo e fora de escopo (seção 3);
     - as cinco jornadas, como fluxos;
     - eventos e comandos (seção 5);
     - dependências de outros times (seção 6);
     - riscos técnicos;
     - critérios de aceite técnicos (seção 7).
   - **Flags:** uma `scope-hint: slice` por fatia, com as flagKeys da seção 4.
4. **Docs técnicos:** rode `/gerar-doc-tecnico` para as fatias 1, 2, 3 e 4, nessa ordem, com `prd: ../prd.md`.
   - Depois de cada doc, rode `/revisar-doc-tecnico --fix-obvious`.
   - Críticos que sobrarem: corrija aplicando a seção 4, com no máximo 3 passadas. Se ainda sobrar, siga a regra de limite de iterações da seção 0.
5. **Não rode** `/gerar-plan` nem `/gerar-back`. Não altere código de nenhum serviço.
6. Subagentes recebem briefing autocontido, com as seções 3 a 7 deste prompt coladas.
7. Produza o resumo final (seção 8).

---

## 3. Escopo

**Dentro:**
- As jornadas emitir, cancelar, renegociar, expirar e baixar.
- Só clientes do **modelo invoice** (`Account.accountChargeType = INVOICE`).
- Agregado `Invoice`, com `Charge` e `Payment` só no que essas jornadas tocam.

**Fora (não modelar, não publicar, não decidir):**
- MerchantAccount, Pricing, Transfer, CardInstrument e Dispute.
- `FeeApplied`, `PaymentReleased`, `PaymentRefunded`, `PaymentDisputed`, `ChargeSuperseded`, cartão e eventos `Merchant*`/beneficiário.
- Chargeback e estorno.
- Modelo BILLET e `REGISTERED_BANK_SLIP`.
- O consumer do tópico de charge request do Financial Receivable, que é uma fatia 5 futura.

**Premissas de domínio (fonte 1):**
- `Invoice` é 1:1 com a charge request, e `ChargeRequestRef` é a chave de idempotência da abertura. Receivables não conhece parcela.
- `Charge` é uma tentativa por meio de pagamento (`BANK_SLIP`, `PAYMENT_LINK`, `PIX`). Pixleto são duas Charges na mesma Invoice.
- Evento de domínio é fato consumado, publicado na mesma transação do agregado.
- Todo comando muta exatamente um agregado.
- Dinheiro sem cobrança correspondente é conciliação, não pagamento.

---

## 4. Decisões fechadas (use sem perguntar)

**D1 · Transporte**
- Consumir SNS do payments via SQS é permitido: a trava Kafka-only vale só para serviços Nexus totalmente greenfield.
- No doc, registre `> **Decisão:** transporte SQS herdado do legado (SNS do payments); saída em Kafka`.

**D2 · Publicação no Kafka**
- `msk-producer` com outbox (`fanout.notifications_stream` + Debezium), pelo golden path `add-msk-producer`, criado na fatia 1.
- Tópico `BANKING-CASH_INVOICE_EVENTS`, com `aggregateId` = UUID da Invoice.
- Sem Debezium disponível, o plano não muda: a indisponibilidade vira risco com dono SRE.

**D3 · Contrato no fio**
- Na v1, o contrato publicado é o do #3942: envelope `StreamNotificationMessage` + payload `InvoiceLifecycleEvent` + `asyncapi.json`. O `banking-cash-risk-compliance` já consome esse contrato.
- Os eventos de domínio (fonte 1) são o modelo interno, mapeado para as actions assim:

| Evento de domínio | `action` no tópico | Publica na v1? |
|---|---|---|
| `InvoiceOpened` | — | **Não.** Fica só no domínio e na projeção; não há consumidor |
| `InvoicePayable` | `OPENED` | Sim. O `OPENED` do Antifraude dispara em PROCESSING → PENDING, que é o `InvoicePayable` |
| `PaymentReceived` | `PAYMENT-RECEIVED` | Sim |
| `InvoiceCanceled` | `CANCELED` | Sim |
| `InvoiceExpired` | `EXPIRED` | Sim |

- A migração das actions para os nomes do domínio fica para depois da v1. Registre como evolução, não como pendência.

**D4 · Dados do evento**
- O payload vem de um endpoint novo no payments, dependência do time do payments: `GET /private-api/v1/invoices/lifecycle-snapshot?invoiceId={id}|chargeId={uuid}`.
  - Ele devolve o `InvoiceCore` e o `PaymentFocus` montados pelo assembler do #3942.
  - Não usa Kafka, Amplitude nem Feign global.
  - Invoice não publicável (comissão percentual, `PROCESSING`, `WITHDRAW_*`) volta com `publishable = false`.
- As regras de negócio de publicação ficam no payments. O bus só envelopa e publica.

**D5 · Chave e resolução da CR**
- `chargeRequestId = invoice.orderId`, vindo do snapshot.
- O `orderId` do SNS **não** é usado como CR, porque em `CHARGE_ACQUITTED` ele é `billet.uuid`.

**D6 · Projeção local de `Invoice`**
- Campos: `id` UUID, `tenant_id`, `charge_request_id` unique, `payments_invoice_id` unique, `status` e `version`.
- Particionada por `tenant_id`, conforme a regra de migration da pattern-library.
- Usos:
  - resolver o UUID do agregado;
  - dedup de negócio (transição de status condicional);
  - descartar evento com `aggregateVersion` menor ou igual ao da projeção.

**D7 · Baixa**
- `PAYMENTS_CHARGE_ACQUITTED` com status pago gera `PaymentReceived`.
- No Pix de conta IP, o `PAYMENTS_CHARGE_RELEASED` gera `PaymentReceived` só se a projeção ainda não estiver `PAID`. Senão, descarta.
- `PAYMENTS_CHARGE_DUPLICATED` e `CHARGE_ACQUITTED` com status `CHARGEBACK`/`REFUNDED` são descartados com métrica `ignored{reason}`, sem ir para DLQ.

**D8 · Expiração**
- `PAYMENTS_CHARGE_REQUEST_EXPIRED` chega uma vez por charge. O bus publica `InvoiceExpired` só na primeira transição da projeção para `EXPIRED`.

**D9 · Ciclo de vida (fatia 2)**
- Só traduz. O callback `POST /v2/invoices/register/{id}` continua no payments-orchestrator.

**D10 · Emissão (fatia 3)**
- `OpenInvoice` conforme o contrato X. Gateway `POST /v2/invoices` com `orderId = chargeRequestId`, idempotente pela unique de `invoice.order_id`.
- O callback de registro passa para o bus **só** para tenants com a flag da fatia 3 ligada. Os orquestradores legados leem a mesma flag e pulam o callback, o que é dependência dos donos do payments-orchestrator.
- Gatilho temporário: `POST /private-api/v1/invoices` no bus, atrás da flag da fatia 3, com o mesmo payload do contrato X. Ele chama o mesmo use case que o consumer futuro vai chamar.

**D11 · Cancelamento e renegociação (fatia 4)**
- `CancelInvoice` é idempotente: cancelar uma invoice já cancelada responde sucesso sem efeito.
- **Renegociação = cancelar a invoice antiga e emitir a nova, nessa ordem.** Nunca pode haver duas invoices pagáveis para a mesma dívida.
- Se a emissão falhar depois do cancelamento: retry com backoff (a emissão é idempotente por `orderId`), depois DLQ com alarme. Não reabre a antiga.
- Gatilho temporário: `POST /private-api/v1/invoices/{chargeRequestId}/cancel` e `POST /private-api/v1/invoices/renegotiate`, atrás da flag da fatia 4.

**D12 · Contrato X (comandos vindos da charge request)**
- Ainda não foi acordado com o Financial Receivable. **Escreva a proposta draft no doc da fatia 3**, derivada da fonte 1:
  - `ChargeRequestRef{id, origin}`, `merchantAccountRef`, `amount: Money`, `dueOn`, `payer: Payer`, `terms: Terms`, `paymentMethods: [PaymentMethodCode]`;
  - `items[]`, `installment{index,count}` (só exibição) e `fiscalDocuments[]`.
- Cancelamento: `ChargeRequestRef` + `reason`.
- Renegociação: `ChargeRequestRef` antigas + comando de abertura da nova.
- Marque como dependência de acordo, com dono = time do Financial Receivable.

**D13 · Flags de fatia** (formato `nexus-{dominio}-{feature}-ff`)
- `nexus-banking-cash-receivables-baixa-ff`
- `nexus-banking-cash-receivables-invoice-lifecycle-ff`
- `nexus-banking-cash-receivables-emissao-ff`
- `nexus-banking-cash-receivables-cancelamento-ff`

Todas são avaliadas por tenant, com fallback OFF.

**D14 · Gate sem usuário**
- Os eventos do payments trazem `userId = 0`, que o `ExperimentService` rejeita.
- Use `TargetUser` explícito com `userId` = usuário técnico configurado em `receivables.experiment.system-user-id`, e `properties{tenantId, caProCompanyId}`. O targeting no Amplitude é por propriedade.

**D15 · Feign**
- O client do payments usa configuração própria, com encoder, decoder e `Request.Options` locais, via `@FeignClient(configuration = PaymentsGatewayFeignConfig.class)`. Isso evita os beans globais que o `spring-ca-starter-experimentation` registra.
- Circuit breaker, fallback e timeouts são obrigatórios.

**D16 · Um escritor de baixa**
- O bus não escreve baixa: ele publica `PaymentReceived`.
- Quem escreve a baixa na v1 é o consumidor do domínio financeiro. Os orquestradores legados pulam as contas migradas usando a flag da fatia 1, o que é dependência dos donos deles.

**D17 · Isolamento do código temporário** (layout por feature da pattern-library)

```
domain/invoice/                  permanente: entities, enumerations, usecases, models/events, mappers
application/invoice/producer/    permanente: InvoiceStreamProducer (dono: building-block msk-producer)
application/invoice/controllers/ permanente: endpoints private-api da emissão e cancelamento
application/paymentsbridge/      TEMPORÁRIO: consumers SQS e mappers de payload do payments
infra/payments/gateway/          TEMPORÁRIO: Feign client, DTOs, fallback, circuit breaker, timeouts
```

- Use cases e eventos de domínio recebem tipos do domínio, nunca DTOs do payments.
- Teste de arquitetura: não incluir (não há building-block). Registre como evolução.

**D18 · Testes**
- Cobertura mínima de 90%.
- Testes de integração mockam messaging (`MockMessagingAutoConfiguration`) e usam WireMock para o payments.
- O fluxo ponta a ponta com LocalStack, Kafka e Debezium fica no `development-environment` (docker-compose), como no showcase.

---

## 5. As 4 fatias

| # | Fatia | Jornadas | Conteúdo | Decisões |
|---|---|---|---|---|
| 1 | **Baixa** (absorve a fundação) | baixar | Projeção `Invoice` + migration; `sqs-consumer` de `CHARGE_ACQUITTED`, `CHARGE_RELEASED` e `CHARGE_DUPLICATED` (este só para descarte); `ProcessPaymentReceivedUseCase`; gateway do snapshot; `msk-producer` + outbox; flag; infra §3 (filas + DLQ, `remote_state` com os ARNs do `payments-infra`); itens de SRE/DBRE | D1–D7, D13–D18 |
| 2 | **Ciclo de vida vindo do payments** | emitir (retorno), cancelar, expirar | Consumers de `INVOICE_REGISTERED` (só atualiza a projeção), `INVOICE_CREATED` → `OPENED`, `INVOICE_CANCELED` → `CANCELED` e `CHARGE_REQUEST_EXPIRED` → `EXPIRED` | D3, D6, D8, D9 |
| 3 | **Emissão** | emitir | `OpenInvoiceUseCase`; gateway `POST /v2/invoices`; callback de registro por flag; endpoint private-api; proposta do contrato X | D10, D12 |
| 4 | **Cancelamento e renegociação** | cancelar, renegociar | `CancelInvoiceUseCase`, `RenegotiateInvoiceUseCase`; gateway de cancelamento; endpoints private-api | D11, D12 |

---

## 6. Dependências externas (registrar com dono; nunca bloqueiam)

| Dependência | Dono | Fatia |
|---|---|---|
| Endpoint `lifecycle-snapshot` (D4) | time do payments | 1, 2 |
| Dispatch de `PAYMENTS_INVOICE_CANCELED` no cancelamento via REST | time do payments | 2 |
| ARNs dos tópicos SNS expostos por `remote_state` no `payments-infra` | time do payments | 1 |
| Tópico `BANKING-CASH_INVOICE_EVENTS` com ACL do bus, Debezium, IAM do MSK, `_RETRY`/`_DLT`, usuário `fanout_stream` | SRE / DBRE | 1 |
| Orquestradores legados lendo as flags das fatias 1 e 3 para pular baixa e callback | donos do payments-orchestrator e do banking-orchestrator | 1, 3 |
| Acordo do contrato X | time do Financial Receivable | 3, 4 |
| `CHARGEBACK-RECEIVED` sem produtor no bus: manter o produtor atual até existir fatia de chargeback | time do Antifraude | fora do escopo |
| Filtro da fila do payments-orchestrator em produção (sem filtro declarado) | time do payments | 1 |
| Pom aponta para `repo.contaazul.ninja:8081`; o `/gerar-back` vai subir o parent | quem rodar o `/gerar-back` | todas |

---

## 7. Critérios de aceite técnicos (para o PRD e os docs)

- Cada evento publicado sai na mesma transação que atualiza a projeção (outbox).
- Reentrega de SQS não gera evento duplicado de negócio (D6).
- Eventos da mesma invoice saem em ordem pela chave de partição, e eventos obsoletos são descartados (D6).
- Mensagens fora do escopo são descartadas com métrica, sem ir para DLQ (D7).
- Desligar a flag da fatia interrompe o efeito sem deploy.
- O `banking-cash-risk-compliance` consome sem mudança (D3).
- Nenhum use case ou evento de domínio depende de `paymentsbridge` ou `infra/payments` (D17).
- Cobertura mínima de 90% (D18).

---

## 8. Entregáveis e resumo final

1. PRD técnico restrito às cinco jornadas, sem métricas nem decisões de negócio, com as 4 flags.
2. 4 `doc-tecnico.md` em status `draft`, revisados pelo `/revisar-doc-tecnico`. Cada doc deve ter:
   - os blocos `> **Decisão:**` que citam as decisões da seção 4 aplicáveis;
   - a tabela §4.3 limitada aos eventos da fatia, com a origem de cada campo;
   - as dependências da seção 6 aplicáveis;
   - os itens de SRE/DBRE;
   - o recorte de pacotes (D17).
3. Resumo final em PT-BR com:
   - os arquivos gerados, com caminho;
   - as respostas dadas aos gates das skills;
   - as premissas e divergências registradas;
   - as pendências que sobraram do limite de iterações;
   - o status do seed do atlas e dos PRs (ou o motivo de não abrir);
   - a ordem sugerida para `/gerar-plan` e `/gerar-back`, com o `/sincronizar-context-layer` greenfield logo depois do primeiro `/gerar-back`.

**Não faça:**
- Alterar código de qualquer serviço.
- Rodar `/gerar-plan` ou `/gerar-back`.
- Ampliar o escopo.
- Publicar ou atualizar as páginas das fontes.
- Parar para perguntar.
