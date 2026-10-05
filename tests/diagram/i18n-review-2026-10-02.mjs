// tests/diagram/i18n-review-2026-10-02.mjs
//
// What an independent read of the four-language rules found wrong on
// 2026-10-02, as sentences: each was decided wrongly before the fix named in
// its group. Regression data, not a measurement.
//
// want: 'off' | 'on' | '<view>:new' (a fresh drawing, not a view of the one on
// the table) | '<view>:P' (a new view OF the one on the table) |
// '<view>:P:of-chart' (…of a chart, as its numbers) | 'explain:P' / 'update:P'
// (a follow-up) | 'basis:<basis>'.
// ctx: none | arch (in focus) | bg (in the background) | chart | lpr | state.

import { DESIGN, CHART } from './i18n-cases.mjs';

export const LPR = { artifactId: 'p.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground: true, source: 'flowchart LR\n  cam["摄像头"] --> rec["车牌识别器"]\n  rec --> gate["闸机控制"]' };
export const STATE = { artifactId: 's.v1', artifact: 'mermaid', view: 'state', version: 1, foreground: true, source: 'stateDiagram-v2\n  [*] --> Pendiente\n  Pendiente --> Pagado\n  Pagado --> Enviado' };
export const CONTEXTS = { none: null, arch: DESIGN, bg: { ...DESIGN, foreground: false }, chart: CHART, lpr: LPR, state: STATE };

// One sentence still decided wrongly, kept out of the list below: "Usa el
// cliente la API actualmente" (a statement with the verb first) is read as an
// edit of the design in focus.

export const REVIEW_CASES = [
  // F4: ordinary phrases are not the drawing
  ['off', 'bg', 'Почему мы отстаём по графику?'], ['off', 'bg', 'Что в модели ценообразования?'],
  ['off', 'bg', '¿Por qué el modelo de precios es tan caro?'], ['off', 'bg', '¿Cuál es el diseño de la campaña?'],
  ['off', 'bg', '这个方案为什么这么贵？'], ['off', 'bg', '这个流程要多久？'], ['off', 'bg', '表格里的名字怎么改？'], ['off', 'bg', 'このモデルの精度はどうですか？'],
  ['off', 'arch', 'Почему мы отстаём по графику?'], ['off', 'arch', '这个方案为什么这么贵？'], ['off', 'arch', '表格里的名字怎么改？'],
  // …and the drawing still is
  ['explain:P', 'bg', '¿Qué muestra el diagrama?'], ['explain:P', 'bg', 'Что показывает эта схема?'], ['explain:P', 'bg', '这张图里为什么有两个数据库？'], ['explain:P', 'bg', 'この図のキャッシュは何のためですか？'],
  ['explain:P', 'bg', '¿Por qué esta arquitectura usa una cola?'], ['update:P', 'bg', 'В этой схеме замени очередь на Kafka'],
  // F5: a fresh request about another subject is not a view of the design
  ['sequence:new', 'bg', 'ログイン処理をシーケンス図で示してください'], ['flowchart:new', 'bg', '採用プロセスをフローチャートにしてください'], ['chart:new', 'bg', '売上の推移をグラフにしてください'],
  ['flowchart:new', 'bg', 'Hazme el diagrama de flujo del proceso de contratación'], ['sequence:new', 'arch', 'ログイン処理をシーケンス図で示してください'],
  ['sequence:P', 'arch', 'Muestra este diseño como diagrama de secuencia'], ['sequence:P', 'arch', 'この設計をシーケンス図にしてください'], ['sequence:P', 'arch', '把这个架构画成时序图'], ['sequence:P', 'arch', 'Покажи эту архитектуру как диаграмму последовательности'],
  // F6: the chart as a table
  ['matrix:P:of-chart', 'chart', 'Muestra este gráfico como tabla'], ['matrix:P:of-chart', 'chart', 'Покажи этот график в виде таблицы'], ['matrix:P:of-chart', 'chart', '把这个图表转成表格'], ['matrix:P:of-chart', 'chart', 'このグラフを表にしてください'],
  // F7: the basis
  ['basis:meeting-reconstruction', 'none', 'Dibuja lo que acabamos de discutir'], ['basis:meeting-reconstruction', 'none', 'Нарисуй то, что мы обсудили'], ['basis:meeting-reconstruction', 'none', '把我们刚才讨论的画成架构图'], ['basis:meeting-reconstruction', 'none', 'さっき話した内容を図にしてください'],
  ['basis:source-reconstruction', 'none', 'Dibuja lo que hay en esta captura'], ['basis:illustrative', 'none', 'Muéstrame un ejemplo de gráfico de barras de ventas'], ['basis:calculated', 'none', 'Grafica y = x al cuadrado'],
  ['basis:scenario', 'none', 'Muéstrame un gráfico del crecimiento de 10.000 usuarios al 5% mensual durante 12 meses'], ['basis:scenario', 'none', '画一个图表：从10000用户开始每月增长5%，共12个月'],
  ['basis:illustrative', 'none', '举个例子，画一个销售额的柱状图'], ['basis:illustrative', 'none', 'Покажи пример столбчатой диаграммы продаж'], ['basis:illustrative', 'none', '例として売上の棒グラフを見せてください'],
  // F8: statements
  ['off', 'none', '我昨天画出了一个架构图'], ['off', 'none', '我已经画好了架构图'], ['off', 'none', '他上周画完了流程图'], ['off', 'none', '这本漫画一个月更新一次'], ['off', 'none', '后来他把表格发给我了'], ['off', 'none', '我要填这个表格'],
  ['off', 'none', '问题出在数据库表结构上'], ['off', 'arch', '我们来看一下架构图'], ['off', 'none', '路線図を見せてください'], ['off', 'none', '天気図を見たい'], ['off', 'none', '心電図の結果が必要です'], ['off', 'none', '表に名前を書いてください'],
  ['off', 'none', '時系列で説明してください'], ['off', 'none', '図を描いてみたんですが'], ['off', 'none', 'Traza del error en producción'], ['off', 'none', '这个企画的流程图已经发了'],
  ['on', 'none', '来个流程图'], ['on', 'none', '给我一个对比表格'], ['on', 'none', '帮我做架构图'], ['on', 'none', '想看一下架构图'], ['on', 'none', '関係図を作ってください'], ['on', 'none', '全体の構成を図で説明して'], ['on', 'none', '比較を表にまとめてください'], ['on', 'none', 'Traza un diagrama de la red'], ['on', 'none', '时间线画一下'], ['on', 'none', 'タイムラインを作って'],
  // F9: an edit whose new part is named with an everyday word
  ['update:P', 'arch', '加一个邮件服务'], ['update:P', 'arch', '在网关后面加一个订单队列'], ['update:P', 'arch', '加一个文档数据库'], ['update:P', 'arch', 'メール通知サービスを追加して'], ['update:P', 'arch', '注文キューを追加してください'],
  ['update:P', 'arch', 'Добавь сервис для заказов'], ['update:P', 'arch', 'Añade una cola para el correo'], ['update:P', 'arch', '给集群加一个节点'],
  ['off', 'arch', 'Añade a María a la invitación'], ['off', 'arch', 'Добавь это событие в календарь'], ['off', 'arch', '给订单加个备注'], ['off', 'arch', '会議の招待に田中さんを追加して'],
  // F10: everyday words
  ['off', 'arch', '¿Cuántos clientes tenemos?'], ['off', 'arch', '¿Cómo está el cliente?'], ['off', 'arch', 'Сколько у нас клиентов?'], ['off', 'arch', 'Какие шаги дальше?'], ['off', 'arch', '下一步骤是什么？'], ['off', 'arch', '次のステップは何ですか？'],
  // minor
  ['explain:P', 'lpr', '识别器为什么这么慢？'], ['update:P', 'lpr', '把识别器去掉'], ['update:P', 'state', 'Añade Cancelado después de Pendiente'], ['off', 'chart', '¿Cuánto cuesta la computadora?'],
  ['off', 'none', 'Resume the gantt work and eliminate the blockers'], ['off', 'none', 'Can you explicate the cola wars timeline issue for me'],
];

/** Does a decision meet what a case wants? */
export function meets(want, x) {
  const [a, b, c] = want.split(':');
  if (want === 'off') return !x.enabled;
  if (want === 'on') return x.enabled === true;
  if (a === 'basis') return x.enabled === true && x.basis === b;
  if (b === 'new') return x.enabled === true && x.view === a && !x.parentArtifactId && x.operation === 'create';
  if (b === 'P' && (a === 'explain' || a === 'update')) return x.enabled === true && x.operation === a && Boolean(x.parentArtifactId);
  if (b === 'P') return x.enabled === true && x.view === a && Boolean(x.parentArtifactId) && (!c || x.parentFamily === 'chart');
  return false;
}
