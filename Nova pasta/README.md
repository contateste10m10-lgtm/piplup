# Multiband Entropy Lab — V0.18 (correções da auditoria V0.17)

Laboratório independente para importar curvas de luz, calcular Sample Entropy (SampEn) e índice de modulação intrínseco por banda, e gerar gráficos exploratórios no navegador. É um site estático, adequado para GitHub Pages: os arquivos importados permanecem no dispositivo do usuário e não são enviados para um backend do projeto.

## O que há de novo na V0.18

- Corrigido o botão fixo de cálculo no celular: o estado `data-busy="false"` não bloqueia mais as execuções seguintes.
- Metadados `canonical`, `og:url`, `og:image` e links para repositório/feedback apontam para `novo_laufey`.
- Barra de status científico recolhível; o mapeamento automático de colunas começa recolhido e pode ser expandido quando necessário.
- O botão “Topo” fica oculto enquanto a barra fixa de cálculo está ativa, evitando sobreposição; o corpo reserva espaço inferior e respeita a safe area.
- Histograma multifonte passa a usar `ceil(sqrt(N))` bins, com máximo de 30, em vez de 30 bins para todos os tamanhos de amostra.
- A média do perfil por banda continua disponível com poucas fontes; a faixa ±1 DP só é desenhada quando cada banda possui pelo menos quatro fontes válidas.
- A tolerância absoluta de coincidência de SampEn no painel temporal é configurável e o losango é rotulado como média do grupo, não como uma nova medição.
- Integridade SRI e política de referência foram adicionadas às dependências externas de gestos/zoom, além de um teste de fumaça Playwright em viewport de 390 px no CI.
- Incluídos bloco de citação BibTeX do software e `CITATION.cff`.

### Limitação de distribuição

Chart.js, Hammer.js e o plugin de zoom continuam sendo carregados de CDNs externos com integridade SRI, pois os pacotes não estavam disponíveis no ambiente de edição para incluí-los de forma verificada no repositório. Portanto, esta versão ainda requer internet para gráficos/gestos e não deve ser descrita como totalmente offline.

## O que há de novo na V0.17

- **Distribuição por classe:** histogramas de densidade com bins compartilhados com quantidade adaptada à amostra (até 30), normalização de área por classe e marcadores para média e mediana.
- **Perfil multibanda:** resumo de cada fonte × banda antes da média entre fontes; exibe curvas individuais (até 12 para preservar a leitura), média destacada e faixa de ±1 desvio-padrão entre fontes. A média e o desvio-padrão continuam incluindo todas as fontes válidas.
- **Heatmap:** usa uma escala contínua inspirada em Viridis, com a mesma escala baseada nos valores presentes na matriz e células ausentes identificadas.
- **Evolução temporal 3 × 3:** painel para até nove fontes e até oito bandas, com escala vertical compartilhada; diamantes mostram a média de grupos de bandas coincidentes; a tolerância absoluta Δ SampEn é configurável.
- **SampEn × variabilidade robusta:** agrupa cores por fonte quando até dez fontes são representadas. O hover mostra classe, janela, banda, σ, r absoluto e quantidade de pontos quando esses campos estão mapeados.
- **Metadados no CSV:** os campos opcionais `sigma`, `r_absoluto` e `n_pontos` podem ser mapeados para o hover e são incluídos na exportação dos registros limpos.
- **Responsividade:** o painel temporal usa 3 colunas em telas amplas, 2 em telas intermediárias e 1 coluna em celulares.

Os gráficos são calculados a partir dos dados importados. A galeria omite visualizações quando a amostra é insuficiente. O painel temporal pode mostrar menos de nove fontes se não houver fontes suficientes com pelo menos quatro janelas e duas bandas válidas.

## O que há de novo na V0.16

- Preserva a identidade visual e o núcleo científico da V0.10, incluindo a camada opcional de correspondências da SampEn e a política de gráficos adaptativos.
- Melhorias de toque, contraste e responsividade; mapeamento em cards no celular; botão de cálculo fixo e foco/rolagem automática entre etapas.
- Adicionados preview da série, painel de proveniência e auto-teste local. O mapa de sensibilidade `m × r` recalcula a última série analisada em uma grade curta e não troca automaticamente os parâmetros principais.
- Adicionado importador de sessão JSON: restaura parâmetros e mapeamento após o arquivo original ser carregado novamente; o JSON não contém os dados brutos.
- A página inclui favicon, imagem de prévia social e citação BibTeX de referência para Sample Entropy.
- Organiza o uso em três etapas: **Dados → Configuração → Resultados**, com botões de navegação que só liberam as etapas disponíveis.
- Destaca uma demonstração sintética com um clique. Ela é identificada como demonstrativa e pode calcular os resultados automaticamente sem usar dados de internet.
- Valida o arquivo após a leitura inicial e mostra linhas, colunas, bandas com dados suficientes e avisos de qualidade antes do cálculo.
- Oferece explicações recolhíveis para os formatos e conceitos principais (`m`, `r`, SampEn e índice de modulação intrínseco).
- Mostra o progresso real por banda durante a análise; um Web Worker do próprio projeto executa os cálculos fora da thread principal quando o navegador permite. Não depende de servidor, Worker remoto, Cloudflare ou backend.
- A leitura de tabelas de texto e de tabelas binárias FITS cede periodicamente tempo ao navegador para atualizar o estado de carregamento em arquivos grandes.
- Os gráficos individuais são gerados sob demanda e as animações foram reduzidas para priorizar fluidez.
- Adiciona exportação de um resumo JSON da sessão com parâmetros e resultados. Esse resumo não inclui os dados brutos do arquivo importado.

## Limitações conhecidas

- **Privacidade e dependências:** os arquivos científicos e dados carregados são processados no navegador e não são enviados ao backend do projeto. Chart.js, Hammer e o plugin de zoom são carregados de CDNs externos com integridade SRI; o CDN recebe requisições do navegador (incluindo IP). Portanto, a V0.18 não é completamente offline. `pako` e as fontes de sistema são locais.

- A importação por URL depende da política CORS do servidor remoto. Para fontes que bloqueiam CORS, baixe o arquivo usando o navegador e carregue-o pela aba **Arquivo local**; esta versão não adiciona proxy nem serviço remoto para contornar a política.
- O progresso do cálculo é apresentado por banda. Uma banda individual muito longa pode demorar, embora o Web Worker mantenha a interface principal responsiva quando está disponível.
- A compatibilidade FITS depende da estrutura de tabela que o leitor consegue reconhecer. Sempre confira o mapeamento de tempo, taxa e incerteza antes de interpretar as métricas.

## Recursos

### Cálculo de Sample Entropy
- Importação local de `.lc.gz`, FITS, `.lc`, `.txt`, `.csv`, `.tsv` e `.dat` (conforme estrutura do arquivo).
- Importação por URL quando o servidor remoto permite CORS; alternativa por download local.
- Mapeamento editável de tempo, taxa/fluxo, erro e oito bandas.
- Dimensão de embedding e tolerância ajustáveis; padrão inicial de SampEn: dimensão de incorporação `m = 2` e `r = 0,2 × σ`. A dimensão `m` da SampEn não é o índice de modulação intrínseco.
- Resultados por banda com SampEn, A/B, índice de modulação intrínseco, contagem de incertezas válidas/excluídas e estados para casos não calculáveis.
- Núcleo científico isolado em `analysis-core.js`, testável sem a interface e usado tanto pela análise completa quanto pela SampEn temporal.
- Curvas de luz individuais e sobreposição das oito bandas, com opção de z-score.
- Sample Entropy temporal em janelas configuráveis de 100, 200, 300, 500, 800 ou 1000 pontos e passo configurável. O cálculo usa busca de candidatos ordenada e permite pedir cancelamento entre janelas.

### Controles dos gráficos
- Zoom por rolagem do mouse e pinça quando o plugin opcional estiver disponível.
- Arraste para selecionar uma região para zoom; `Shift` + arraste permite mover a vista.
- Botões `+`, `−`, `Reset` e `PNG` em cada gráfico; o heatmap tem controles próprios para ampliar/reduzir as células.
- O zoom manual por botões continua disponível mesmo se o plugin de gestos não carregar.

### Gráficos da tabela individual (uma linha por fonte/objeto)
- Histograma global da SampEn.
- Histogramas de SampEn sobrepostos por classe, com bins comuns.
- Dispersão log–log SampEn × índice de modulação intrínseco, incluindo ajuste log–log quando possível.
- Gráfico de bolhas SampEn × modulação com uma terceira variável real selecionada no mapeamento.
- SampEn média ± desvio-padrão por classe.
- Índice de modulação médio ± desvio-padrão por classe, quando disponível.
- Tabela auditável com paginação e exportação dos registros válidos.

### Galeria multifonte (formato longo)
- Histograma global; histogramas de densidade por classe com bins compartilhados e linhas de média/mediana.
- Painel temporal 3 × 3 para até nove fontes e oito bandas, com tolerância absoluta de coincidência configurável (padrão 0,001).
- Perfil por banda com linhas individuais por fonte, média entre fontes e faixa de ±1 DP.
- Histograma global e histogramas sobrepostos por classe.
- Perfil médio de SampEn pelas bandas.
- Ranking/resumo de SampEn por fonte.
- Heatmap fonte × banda.
- Dispersão SampEn × variabilidade robusta.
- Dispersão SampEn × índice de modulação.
- Gráfico de bolhas com uma terceira coluna quantitativa.
- Evolução temporal de SampEn por janela com bandas sobrepostas.
- Sobreposição de curvas de luz brutas de duas fontes na mesma banda.
- Tabelas paginadas; todos os registros válidos seguem disponíveis para os gráficos e a exportação, não apenas a página atualmente visível.

## Formatos de dados

### Tabela individual
Uma linha por fonte/objeto, por exemplo:

```csv
source,class,sampen,modulation_index_percent,bubble_size
OBJETO_A,Classe_A,1.23,12.8,146
OBJETO_B,Classe_B,0.91,17.0,203
```

`source`, `class`, `modulation_index_percent` e `bubble_size` são opcionais conforme o gráfico. O campo `sampen` é obrigatório para a galeria de catálogo. Para o gráfico de bolhas, a terceira variável tem de vir dos dados; não se fabricam valores apenas para preencher o gráfico.

### Tabela multifonte fonte × janela × banda
Uma linha por combinação fonte/janela/banda, por exemplo:

```csv
fonte,janela,banda,tempo,fluxo,sampen,classe_fonte,variabilidade_robusta,modulation_index_percent,n_pontos,snr_media
OBJETO_A,1,band_1,12345,0.0021,1.45,Classe_A,0.32,12.8,200,2.1
```

Os campos de classe, janela, banda, tempo, fluxo, variabilidade, modulação e tamanho de bolha são mapeados separadamente. Os gráficos só são criados quando as colunas necessárias estiverem disponíveis. A dimensão de incorporação da SampEn não é o índice de modulação intrínseco.

Para sobreposição de curvas brutas, forneça linhas por ponto temporal, com fonte, banda, tempo e fluxo/RATE. Um CSV de resultados de SampEn não contém, em geral, todos os pontos necessários para recriar a curva original.

## Publicar no GitHub Pages

1. Extraia o ZIP e envie todos os arquivos e pastas para a raiz do repositório na branch `main` — incluindo `analysis-core.js`, `tests/` e `.github/`, além de `index.html`, `styles.css`, `app.js`, `README.md`, `CHANGELOG.md` e `.nojekyll`.
2. No GitHub, abra **Settings → Pages**.
3. Em **Build and deployment**, selecione **Deploy from a branch**, branch `main` e pasta `/(root)`.
4. Salve, aguarde a publicação e teste os gráficos no endereço fornecido pelo GitHub.

O site não requer servidor Python/Node em produção. O Chart.js e bibliotecas opcionais são carregados por CDN; é necessária conexão para carregar essas bibliotecas. Sem o plugin de zoom, os botões manuais `+`, `−`, `Reset` e `PNG` continuam disponíveis.

## Limitações científicas

- O cálculo deve ser interpretado junto com a cadência, lacunas, unidades, valores inválidos e parâmetros escolhidos.
- Janelas de uma mesma fonte não são automaticamente observações independentes para testes inferenciais.
- O site não inventa intervalos de energia, unidades, métricas de variabilidade ou índice de modulação ausentes do arquivo.
- O índice de modulação intrínseco é calculado localmente a partir da curva e da coluna de incerteza mapeada, conforme a equação do artigo. A SampEn pode ser calculada mesmo quando essa coluna não está disponível; nesse caso, a modulação fica indisponível com status explícito.
- A fórmula de modulação implementada usa variância amostral (divisor N−1), conforme o script Python do projeto; o artigo apresenta a fórmula, mas não explicita o divisor.
- A SampEn segue H_SE = −ln(A/B), distância de Chebyshev, pares não idênticos e tolerância relativa à dispersão da própria banda. A implementação precisa ser validada numericamente contra EntropyHub v2.0 e curvas Swift-BAT reais antes de ser considerada reproduzível em nível de publicação.

## Arquivos

- `index.html`: interface.
- `styles.css`: estilos responsivos.
- `app.js`: importação, interface, gráficos, paginação, análise temporal, biblioteca NASA, exportação e zoom.
- `analysis-core.js`: cálculo de SampEn e índice de modulação intrínseco.
- `analysis-worker.js`: worker local do navegador para manter a interface responsiva durante cálculos longos. Deve ser publicado na mesma pasta dos arquivos HTML/JS.
- `tests/`: testes automatizados dos algoritmos e do contrato entre interface e núcleo.
- `.github/workflows/tests.yml`: executa os testes com Node.js em pushes e pull requests.
- `.nojekyll`: evita processamento Jekyll desnecessário em publicação estática.

### Navegação dos gráficos (base V0.10, ajustes V0.16)
Cada gráfico possui controles para abrir uma visualização em tela cheia, arrastar para navegar pelos eixos e restaurar o zoom. A navegação do mouse usa **Ctrl + arraste para mover** e **Ctrl + roda para zoom** quando o plugin é carregado; o reset restaura os eixos e a tecla **Esc** fecha a visualização ampliada. Esses controles são adicionados também aos gráficos dinâmicos.


## Correspondências de padrões da Sample Entropy (edição V0.10)

Na seção de curvas de luz, ative **Mostrar correspondências da SampEn** e escolha uma banda. Linhas tracejadas conectam observações correspondentes em templates de dimensão `m` (contagem B); linhas contínuas indicam pares que também correspondem quando o template é estendido para `m+1` (contagem A). A distância é a mesma distância de Chebyshev e a mesma tolerância `r` usadas pelo núcleo no cálculo científico.

Por legibilidade, a visualização desenha uma amostra limitada e reproduzível dos pares, calculada somente quando o usuário ativa a camada visual. O cálculo completo de A, B e SampEn continua usando todos os pares válidos; sem essa opção ativada, não há custo adicional de coleta das correspondências. Essa camada é explicativa: ela não altera as séries nem as estatísticas. O tooltip do gráfico “Sample Entropy por energia” também apresenta A e B para cada banda.


## Seleção adaptativa dos gráficos (patch da V0.10)
A interface evita desenhar gráficos quando a amostra é pequena, os valores quase não variam, há poucas fontes independentes ou a terceira dimensão do gráfico de bolhas não acrescenta informação. As visualizações secundárias ficam em **Exploração avançada** e são geradas somente quando essa seção é aberta. A tabela e a exportação preservam os registros completos. Para conjuntos grandes, alguns gráficos limitam a quantidade de pontos exibidos, com aviso na própria interface; essa redução não é aplicada aos cálculos científicos.

## Auto-teste, sensibilidade e reprodução

Na seção **Metodologia e auto-teste**, rode o auto-teste local para verificar invariantes simples do núcleo e abra o mapa de sensibilidade `m × r` depois de calcular uma banda. O mapa mostra a dependência do valor de SampEn em relação aos parâmetros; não seleciona automaticamente o melhor valor e não testa significância.

O painel **Reprodutibilidade e proveniência** registra a origem, parâmetros, versão do algoritmo, timestamp e identificador do arquivo. O export JSON guarda a configuração e os resultados, mas não contém os dados brutos. Para recalcular a sessão, mantenha o arquivo original.

Referência de definição para Sample Entropy:

> Richman, J. S.; Moorman, J. R. “Physiological time-series analysis using approximate entropy and sample entropy.” *American Journal of Physiology-Heart and Circulatory Physiology* 278(6), H2039–H2049 (2000). https://doi.org/10.1152/ajpheart.2000.278.6.H2039

```bibtex
@article{RichmanMoorman2000SampEn,
  author  = {Richman, Joshua S. and Moorman, J. Randall},
  title   = {Physiological time-series analysis using approximate entropy and sample entropy},
  journal = {American Journal of Physiology-Heart and Circulatory Physiology},
  volume  = {278}, number = {6}, pages = {H2039--H2049}, year = {2000},
  doi     = {10.1152/ajpheart.2000.278.6.H2039}
}
```

A equivalência numérica completa com EntropyHub, a validação com curvas Swift-BAT reais, intervalos bootstrap e séries substitutas permanecem como trabalhos futuros; não use os resultados como validados para publicação sem essa checagem.
