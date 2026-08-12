/**
 * 外部 Provider 的**强制 Mock 开关**。
 *
 * 为什么需要它:E2E 断言的是 Mock 的确定性数据(候选型号、数据更新时间、价格阶梯)。
 * 开发者本地 `.env.local` 里如果配了真实 ezPLM / DigiKey 凭据,同一套用例就会去打真实接口 ——
 * 拿不到相同的数据、用例随即变红,而没有这些变量的环境却是绿的。
 * 这种「本地红、别处绿」最耗人:谁都说不清是代码坏了还是环境不同。
 *
 * 试过用空字符串覆盖,不行:Next 的 env 加载把空串当作未设置,
 * `.env.local` 里的真值仍会填回来。所以需要一个**显式开关**。
 *
 * 纪律:
 * - **默认关闭**,生产与真实联调不受任何影响;
 * - 只由 E2E 的 webServer 显式打开;
 * - 打开时 `providerMode()` 一律回 `mock`,页面上的「数据源形态」也会如实显示 Mock,
 *   **不会出现「已联调」的假象**。
 */
export function forceMockProviders(): boolean {
  return process.env.PROVIDERS_FORCE_MOCK === "1";
}
