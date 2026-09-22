import re
from zoneinfo import ZoneInfo


def _money(value):
    return f"{value:+,.2f} 元" if value is not None else "数据不足"


def _value(value):
    return f"{value:,.2f} 元" if value is not None else "—"


def _percent(value):
    return f"{value:+.2f}%" if value is not None else "—"


def _time(value):
    return value.astimezone(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d %H:%M")


def _day(value):
    # price_as_of is a market observation date. Converting a US close timestamp
    # to Beijing time would incorrectly move it to the following calendar day.
    return value.strftime("%m-%d") if value else "—"


def _quality(value):
    return {
        "observed": "精确观察",
        "partial_window_estimate": "最近可比行情",
        "daily_snapshot_estimate": "每日快照",
    }.get(value, "数据不足")


def contribution_table(daily: dict) -> str:
    rows = [row for row in daily["contributors"] if row.get("daily_change_cny") is not None]
    rows = [row for row in rows if row.get("daily_change_cny") != 0][:14]
    lines = ["### 今日各持仓贡献", ""]
    if not rows:
        return "\n".join(lines + ["暂时没有可比较的持仓行情。"])
    lines.extend([
        "| 名称 | 代码 | 当前市值 | 区间贡献 | 区间涨跌 | 行情区间 |",
        "| --- | --- | ---: | ---: | ---: | --- |",
    ])
    for row in rows:
        start = _day(row.get("baseline_price_as_of"))
        end = _day(row.get("end_price_as_of"))
        period = start if start == end else f"{start} → {end}"
        name = str(row.get("name") or "未命名资产").replace("|", "／")
        symbol = str(row.get("symbol") or "—").replace("|", "／")
        lines.append(
            f"| {name} | {symbol} | {_value(row.get('current_value_cny'))} | "
            f"{_money(row.get('daily_change_cny'))} | {_percent(row.get('daily_change_pct'))} | "
            f"{period} · {_quality(row.get('data_quality'))} |"
        )
    quality = daily.get("calculation_quality")
    if quality == "estimate":
        lines.extend([
            "",
            f"> 本表按最近可比行情估算，覆盖当前组合约 {daily.get('coverage_pct', 0):.1f}%；"
            "节假日和不同市场收盘时间可能使各行行情区间不同。",
        ])
    return "\n".join(lines)


def report_facts(context: dict) -> str:
    report = context["report"]
    lines = [f"> 生成于北京时间 {_time(report['generated_at'])}；美股状态：{context['market_clock']['us_market_status']}。",
             f"> 新闻覆盖：{_time(report['news_window_start'])} 至 {_time(report['news_window_end'])}（北京时间）。"]
    if report["kind"] == "daily_news":
        lines.append(f"> 该时间窗内已录入 {len(context['news'])} 条去重后相关资讯；标题和摘要不等于全文核验。")
        return "\n".join(lines)
    daily = context["daily_portfolio"]
    lines.extend([
        f"> 复盘区间：{_time(daily['window_start'])} 至 {_time(daily['window_end'])}（北京时间）。",
        "", "## 账本核对", "", "| 指标 | 结果 |", "| --- | ---: |",
        f"| 区间投资损益{'（估算）' if daily.get('calculation_quality') == 'estimate' else ''} | {_money(daily['investment_pnl_cny'])} |",
        f"| 区间收益率{'（估算）' if daily.get('calculation_quality') == 'estimate' else ''} | {str(round(daily['investment_return_pct'], 2)) + '%' if daily['investment_return_pct'] is not None else '数据不足'} |",
        f"| 外部净入金 | {_money(daily['external_flow_cny'])} |",
        f"| 已实现盈亏（已包含，不重复相加） | {_money(daily['realized_gain_cny'])} |",
    ])
    if daily["missing_contributor_count"]:
        lines.extend(["", f"仍有 {daily['missing_contributor_count']} 项持仓缺少可比行情；当前结果覆盖约 {daily.get('coverage_pct', 0):.1f}% 的组合市值。"])
    if daily["transaction_events"]:
        lines.extend(["", "### 区间交易", ""])
        for event in daily["transaction_events"]:
            text = str(event["description"]).replace("\n", " ")
            nature = "外部资金流" if event["is_external_flow"] else "组合内交易/资金移动"
            lines.append(f"- {text}；{nature}；已实现盈亏 {_money(event['realized_gain_cny'])}。")
    else:
        lines.extend(["", "此区间没有记录到交易流水。"])
    lines.extend(["", contribution_table(daily)])
    return "\n".join(lines)


def render_report(context: dict, narrative: str) -> str:
    allowed_urls = {row["source_url"] for row in [*context["news"], *context["events"]] if row.get("source_url")}
    def checked_link(match):
        label, url = match.group(1), match.group(2)
        return match.group(0) if url in allowed_urls else f"{label}（引用未核验）"
    narrative = re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", checked_link, narrative)
    for rows, prefix in ((context["news"], "N"), (context["events"], "E")):
        for index, row in enumerate(rows, 1):
            reference = f"[{prefix}{index}]"
            if row.get("source_url"):
                narrative = narrative.replace(reference, f"[{row.get('source') or prefix + str(index)}]({row['source_url']})")
    narrative = re.sub(r"^# [^\n]+\n*", "", narrative.strip(), count=1)
    return report_facts(context) + "\n\n" + narrative
