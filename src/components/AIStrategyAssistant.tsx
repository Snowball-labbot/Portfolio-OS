import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, Download, FileImage, FileText, Loader2, Save, Send, Sparkles, Trash2, X } from 'lucide-react';
import { ASSET_CONFIG } from '@/constants/assets';
import { api, getErrorMessage } from '@/lib/api';
import { useAssetStore } from '@/store/useAssetStore';
import { AssetType, ExtractedHolding, StrategyAdviceRequest } from '@/types';

interface AIStrategyAssistantProps {
  open: boolean;
  onClose: () => void;
  selectedStrategy: unknown;
  allocationRows: Array<Record<string, unknown>>;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ReportRow {
  type: string;
  label: string;
  color: string;
  currentValue: number;
  currentPercent: number;
  targetPercent: number;
  gap: number;
  status: string;
}

const CHAT_STORAGE_KEY = 'zichanguanli.aiStrategyAssistant.messages.v1';
const MAX_STORED_MESSAGES = 50;
const MAX_HISTORY_MESSAGES = 10;

const TEXT = {
  title: '\u0041\u0049 \u7b56\u7565\u52a9\u624b',
  subtitle: '\u57fa\u4e8e\u5f53\u524d\u6301\u4ed3\u751f\u6210\u914d\u7f6e\u5efa\u8bae\uff0c\u6216\u4ece\u622a\u56fe\u8bc6\u522b\u6301\u4ed3\u6570\u636e',
  adviceTab: '\u914d\u7f6e\u5efa\u8bae',
  imageTab: '\u56fe\u7247\u8bc6\u522b\u5bfc\u5165',
  reportTab: '\u0048\u0054\u004d\u004c \u62a5\u544a',
  currentAssets: '\u5f53\u524d\u8d44\u4ea7',
  holdings: '\u4e2a\u6301\u4ed3',
  constraints: '\u8865\u5145\u4f60\u7684\u76ee\u6807\u6216\u7ea6\u675f',
  promptPlaceholder: '\u4f8b\u5982\uff1a\u672a\u6765\u4e00\u5e74\u5e0c\u671b\u73b0\u91d1\u6bd4\u4f8b\u66f4\u9ad8\uff0c\u4e0d\u60f3\u589e\u52a0\u592a\u591a\u7f8e\u80a1\u6ce2\u52a8\u3002',
  sendAdvice: '\u53d1\u9001\u5e76\u751f\u6210\u5efa\u8bae',
  chatEmpty: '\u70b9\u51fb\u5de6\u4fa7\u6309\u94ae\u540e\uff0c\u8fd9\u91cc\u4f1a\u663e\u793a\u4f60\u548c \u0041\u0049 \u7684\u5bf9\u8bdd\u8bb0\u5f55\u3002',
  thinking: '\u6b63\u5728\u5206\u6790\u5f53\u524d\u914d\u7f6e...',
  you: '\u4f60',
  assistant: '\u0041\u0049 \u7b56\u7565\u52a9\u624b',
  defaultPrompt: '\u8bf7\u57fa\u4e8e\u6211\u7684\u5f53\u524d\u6301\u4ed3\u548c\u76ee\u6807\u7b56\u7565\uff0c\u751f\u6210\u4e00\u4efd\u8d44\u4ea7\u914d\u7f6e\u5efa\u8bae\u3002',
  adviceError: '\u0041\u0049 \u5efa\u8bae\u751f\u6210\u5931\u8d25',
  clearChat: '\u6e05\u7a7a\u5bf9\u8bdd',
  uploadTitle: '\u4e0a\u4f20\u57fa\u91d1\u6216\u8bc1\u5238\u6301\u4ed3\u622a\u56fe',
  uploadDesc: '\u8bc6\u522b\u540e\u4f1a\u5148\u8fdb\u5165\u786e\u8ba4\u8868\u683c\uff0c\u786e\u8ba4\u524d\u4e0d\u4f1a\u5199\u5165\u6570\u636e\u5e93\u3002',
  selectAll: '\u5168\u9009',
  clearAll: '\u6e05\u9664\u5168\u9009',
  deleteSelected: '\u5220\u9664\u9009\u4e2d',
  chooseImage: '\u9009\u62e9\u56fe\u7247',
  imageError: '\u56fe\u7247\u8bc6\u522b\u5931\u8d25',
  importError: '\u5bfc\u5165\u5931\u8d25',
  reportTitle: '\u751f\u6210\u5f53\u524d\u8d44\u4ea7\u5206\u6790\u62a5\u544a',
  reportDesc: '\u5bfc\u51fa\u4e00\u4efd\u53ef\u79bb\u7ebf\u6253\u5f00\u7684\u0048\u0054\u004d\u004c\u62a5\u544a\uff0c\u5305\u542b\u6301\u4ed3\u997c\u56fe\u3001\u7b56\u7565\u5bf9\u6bd4\u56fe\u548c\u7b80\u6d01\u6587\u5b57\u5206\u6790\u3002',
  generateReport: '\u751f\u6210\u5e76\u4e0b\u8f7d\u62a5\u544a',
  reportGenerating: '\u6b63\u5728\u751f\u6210\u62a5\u544a...',
  reportEmpty: '\u5f53\u524d\u6682\u65e0\u8d44\u4ea7\uff0c\u6dfb\u52a0\u6301\u4ed3\u540e\u518d\u751f\u6210\u62a5\u544a\u3002',
  reportFormat: '\u683c\u5f0f\uff1a\u5355\u6587\u4ef6 \u0048\u0054\u004d\u004c\uff0c\u56fe\u8868\u4f7f\u7528\u5185\u8054 \u0053\u0056\u0047\uff0c\u9002\u5408\u5b58\u6863\u548c\u5206\u4eab\u3002',
  chooseOne: '\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u6761\u8bc6\u522b\u7ed3\u679c',
  tableEmpty: '\u4e0a\u4f20\u622a\u56fe\u540e\uff0c\u8bc6\u522b\u7ed3\u679c\u4f1a\u663e\u793a\u5728\u8fd9\u91cc\u3002',
  selectedCount: '\u5df2\u9009\u62e9',
  confirmImport: '\u786e\u8ba4\u5bfc\u5165\u9009\u4e2d\u6301\u4ed3',
  rowUnit: '\u6761',
  footer: '\u0041\u0049 \u5efa\u8bae\u4ec5\u7528\u4e8e\u6574\u7406\u548c\u5206\u6790\uff0c\u4e0d\u6784\u6210\u6295\u8d44\u5efa\u8bae\uff1b\u56fe\u7247\u8bc6\u522b\u7ed3\u679c\u8bf7\u786e\u8ba4\u540e\u518d\u5bfc\u5165\u3002',
};

function loadStoredMessages(): ChatMessage[] {
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : `${item.role}-${Date.now()}-${Math.random()}`,
        role: item.role,
        content: item.content,
      }))
      .slice(-MAX_STORED_MESSAGES);
  } catch {
    return [];
  }
}

const tableHeaders = [
  '\u5bfc\u5165',
  '\u7c7b\u578b',
  '\u5e02\u573a',
  '\u4ee3\u7801',
  '\u540d\u79f0',
  '\u4efd\u989d/\u80a1\u6570',
  '\u6210\u672c',
  '\u6700\u65b0\u4ef7',
  '\u5e01\u79cd',
  '\u6c47\u7387',
  '\u7f6e\u4fe1\u5ea6',
];

const assetTypeOptions = [
  AssetType.CASH,
  AssetType.STOCK,
  AssetType.BOND,
  AssetType.FUND,
  AssetType.PROPERTY,
  AssetType.OTHER,
];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function normalizeHolding(row: ExtractedHolding): ExtractedHolding {
  return {
    type: row.type || AssetType.FUND,
    market: row.market || '',
    symbol: row.symbol || '',
    name: row.name || '',
    quantity: Number(row.quantity || 0),
    unit_price: Number(row.unit_price || 0),
    current_price: row.current_price === null || row.current_price === undefined ? null : Number(row.current_price),
    currency: row.currency || 'CNY',
    exchange_rate_to_cny: Number(row.exchange_rate_to_cny || 1),
    group: row.group || '',
    note: row.note || '',
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function toNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatCurrency(value: number): string {
  return `\u00a5${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function markdownToReportHtml(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const blocks: string[] = [];
  let listItems: string[] = [];
  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push(`<ul>${listItems.join('')}</ul>`);
      listItems = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    if (/^#{1,4}\s+/.test(trimmed)) {
      flushList();
      blocks.push(`<h3>${escapeHtml(trimmed.replace(/^#{1,4}\s+/, ''))}</h3>`);
    } else if (/^[-*]\s+/.test(trimmed)) {
      listItems.push(`<li>${escapeHtml(trimmed.replace(/^[-*]\s+/, ''))}</li>`);
    } else {
      flushList();
      blocks.push(`<p>${escapeHtml(trimmed)}</p>`);
    }
  }
  flushList();
  return blocks.join('');
}

function getStrategyText(strategy: unknown, field: 'name' | 'description' | 'riskLevel', fallback: string): string {
  if (!strategy || typeof strategy !== 'object') return fallback;
  const value = (strategy as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function normalizeReportRows(rows: Array<Record<string, unknown>>): ReportRow[] {
  return rows.map((row) => {
    const type = String(row.type || '');
    const config = ASSET_CONFIG[type as AssetType];
    const currentPercent = toNumber(row.currentPercent);
    const targetPercent = toNumber(row.targetPercent);
    const gap = row.gap === undefined ? currentPercent - targetPercent : toNumber(row.gap);
    return {
      type,
      label: String(row.label || config?.label || type || '-'),
      color: String(row.color || config?.color || '#64748b'),
      currentValue: toNumber(row.currentValue),
      currentPercent,
      targetPercent,
      gap,
      status: String(row.status || (gap > 3 ? 'over' : gap < -3 ? 'under' : 'near')),
    };
  });
}

function piePath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  const start = {
    x: cx + radius * Math.cos(startAngle),
    y: cy + radius * Math.sin(startAngle),
  };
  const end = {
    x: cx + radius * Math.cos(endAngle),
    y: cy + radius * Math.sin(endAngle),
  };
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)} Z`;
}

function buildPieSvg(rows: ReportRow[]): string {
  const visibleRows = rows.filter((row) => row.currentPercent > 0.01);
  if (visibleRows.length === 0) {
    return '<div class="empty-chart">\u6682\u65e0\u53ef\u89c6\u5316\u6570\u636e</div>';
  }
  let angle = -Math.PI / 2;
  const slices = visibleRows.map((row) => {
    const nextAngle = angle + (row.currentPercent / 100) * Math.PI * 2;
    const tooltip = `${row.label}: ${row.currentPercent.toFixed(1)}% / ${formatCurrency(row.currentValue)}`;
    const path = row.currentPercent >= 99.99
      ? `<circle class="chart-segment" data-tooltip="${escapeHtml(tooltip)}" cx="120" cy="120" r="92" fill="${escapeHtml(row.color)}"></circle>`
      : `<path class="chart-segment" data-tooltip="${escapeHtml(tooltip)}" d="${piePath(120, 120, 92, angle, nextAngle)}" fill="${escapeHtml(row.color)}"></path>`;
    angle = nextAngle;
    return path;
  }).join('');
  const legend = visibleRows.map((row) => `
    <div class="legend-item">
      <span class="dot" style="background:${escapeHtml(row.color)}"></span>
      <span>${escapeHtml(row.label)}</span>
      <strong>${row.currentPercent.toFixed(1)}%</strong>
    </div>
  `).join('');
  return `
    <div class="pie-wrap">
      <svg viewBox="0 0 240 240" role="img" aria-label="asset allocation pie chart">${slices}</svg>
      <div class="legend">${legend}</div>
    </div>
  `;
}

function statusLabel(status: string): string {
  if (status === 'over') return '\u8d85\u914d';
  if (status === 'under') return '\u4f4e\u914d';
  return '\u63a5\u8fd1';
}

function buildComparisonBars(rows: ReportRow[]): string {
  return rows.map((row) => `
    <div class="compare-row" data-tooltip="${escapeHtml(`${row.label}: 当前 ${row.currentPercent.toFixed(1)}%，目标 ${row.targetPercent.toFixed(1)}%，差距 ${formatPercent(row.gap)}`)}">
      <div class="compare-label">
        <span>${escapeHtml(row.label)}</span>
        <strong class="${row.gap >= 0 ? 'positive' : 'negative'}">${formatPercent(row.gap)}</strong>
      </div>
      <div class="bar-pair">
        <div class="bar-line"><span>\u5f53\u524d</span><div class="bar-bg"><i style="width:${Math.min(100, Math.max(0, row.currentPercent)).toFixed(2)}%;background:${escapeHtml(row.color)}"></i></div><b>${row.currentPercent.toFixed(1)}%</b></div>
        <div class="bar-line target"><span>\u76ee\u6807</span><div class="bar-bg"><i style="width:${Math.min(100, Math.max(0, row.targetPercent)).toFixed(2)}%"></i></div><b>${row.targetPercent.toFixed(1)}%</b></div>
      </div>
    </div>
  `).join('');
}

function buildReportHtml(
  assets: ReturnType<typeof useAssetStore.getState>['assets'],
  rows: ReportRow[],
  selectedStrategy: unknown,
  aiAnalysis?: string,
): string {
  const total = assets.reduce((sum, asset) => sum + Number(asset.current_value_cny || 0), 0);
  const strategyName = getStrategyText(selectedStrategy, 'name', '\u672a\u547d\u540d\u7b56\u7565');
  const strategyDesc = getStrategyText(selectedStrategy, 'description', '\u5f53\u524d\u9009\u4e2d\u7684\u76ee\u6807\u914d\u7f6e\u7b56\u7565');
  const riskLevel = getStrategyText(selectedStrategy, 'riskLevel', '\u672a\u6807\u6ce8');
  const sortedAssets = [...assets].sort((a, b) => Number(b.current_value_cny || 0) - Number(a.current_value_cny || 0));
  const topAssets = sortedAssets.slice(0, 8);
  const topThreePercent = total > 0
    ? sortedAssets.slice(0, 3).reduce((sum, asset) => sum + Number(asset.current_value_cny || 0), 0) / total * 100
    : 0;
  const sortedGaps = [...rows].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  const notableGaps = sortedGaps.filter((row) => Math.abs(row.gap) > 3);
  const biggestGaps = notableGaps.slice(0, 4);
  const equityPercent = rows
    .filter((row) => row.type === AssetType.STOCK || row.type === AssetType.FUND)
    .reduce((sum, row) => sum + row.currentPercent, 0);
  const cashPercent = rows.find((row) => row.type === AssetType.CASH)?.currentPercent ?? 0;
  const foreignPercent = total > 0
    ? assets.filter((asset) => asset.currency !== 'CNY').reduce((sum, asset) => sum + Number(asset.current_value_cny || 0), 0) / total * 100
    : 0;
  const reportDate = new Date().toLocaleString('zh-CN');

  const gapSummary = biggestGaps.length > 0
    ? biggestGaps.map((row) => `${escapeHtml(row.label)}${row.gap > 0 ? '\u8d85\u914d' : '\u4f4e\u914d'} ${Math.abs(row.gap).toFixed(1)} \u4e2a\u767e\u5206\u70b9`).join('\uff1b')
    : '\u5f53\u524d\u914d\u7f6e\u4e0e\u76ee\u6807\u7b56\u7565\u7684\u4e3b\u8981\u5206\u7c7b\u5dee\u8ddd\u8f83\u5c0f\u3002';
  const aiAnalysisHtml = aiAnalysis?.trim() ? markdownToReportHtml(aiAnalysis) : '';
  const riskNotes = [
    topThreePercent > 60 ? `\u524d\u4e09\u5927\u6301\u4ed3\u5360\u6bd4\u7ea6 ${topThreePercent.toFixed(1)}%\uff0c\u9700\u5173\u6ce8\u96c6\u4e2d\u5ea6\u3002` : '',
    equityPercent > 70 ? `\u80a1\u7968\u548c\u57fa\u91d1\u5408\u8ba1\u5360\u6bd4\u7ea6 ${equityPercent.toFixed(1)}%\uff0c\u7ec4\u5408\u5bf9\u6743\u76ca\u5e02\u573a\u6ce2\u52a8\u8f83\u654f\u611f\u3002` : '',
    cashPercent < 5 ? `\u73b0\u91d1\u5360\u6bd4\u7ea6 ${cashPercent.toFixed(1)}%\uff0c\u6d41\u52a8\u6027\u7f13\u51b2\u504f\u8584\u3002` : '',
    foreignPercent > 20 ? `\u5916\u5e01\u8d44\u4ea7\u6298\u7b97\u5360\u6bd4\u7ea6 ${foreignPercent.toFixed(1)}%\uff0c\u6c47\u7387\u53d8\u52a8\u4f1a\u5f71\u54cd\u603b\u8d44\u4ea7\u3002` : '',
  ].filter(Boolean);

  const gapRows = rows.map((row) => `
    <tr>
      <td><span class="dot" style="background:${escapeHtml(row.color)}"></span>${escapeHtml(row.label)}</td>
      <td>${formatCurrency(row.currentValue)}</td>
      <td>${row.currentPercent.toFixed(1)}%</td>
      <td>${row.targetPercent.toFixed(1)}%</td>
      <td class="${row.gap >= 0 ? 'positive' : 'negative'}">${formatPercent(row.gap)}</td>
      <td><span class="pill ${row.status}">${statusLabel(row.status)}</span></td>
    </tr>
  `).join('');

  const holdingRows = topAssets.map((asset) => {
    const percent = total > 0 ? Number(asset.current_value_cny || 0) / total * 100 : 0;
    const config = ASSET_CONFIG[asset.type];
    return `
      <tr>
        <td>${escapeHtml(asset.name)}</td>
        <td>${escapeHtml(config?.label || asset.type)}</td>
        <td>${escapeHtml(asset.symbol || '-')}</td>
        <td>${formatCurrency(Number(asset.current_value_cny || 0))}</td>
        <td>${percent.toFixed(1)}%</td>
        <td>${escapeHtml(asset.currency)}</td>
      </tr>
    `;
  }).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(strategyName)} - \u8d44\u4ea7\u914d\u7f6e\u5206\u6790\u62a5\u544a</title>
  <style>
    *{box-sizing:border-box} body{margin:0;background:#f6f8fb;color:#111827;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Arial,sans-serif;line-height:1.65}
    .page{max-width:1100px;margin:0 auto;padding:36px 28px 56px}.hero{background:#173ea5;color:#fff;border-radius:18px;padding:34px;box-shadow:0 18px 40px rgba(23,62,165,.18)}
    .hero h1{margin:0;font-size:34px;letter-spacing:.02em}.hero p{margin:12px 0 0;color:#dbeafe}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:20px}
    .stat{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:14px}.stat span{display:block;font-size:12px;color:#bfdbfe}.stat strong{display:block;margin-top:4px;font-size:22px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px}.card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:22px;box-shadow:0 10px 28px rgba(15,23,42,.04)}
    h2{font-size:22px;margin:0 0 14px} h3{font-size:16px;margin:18px 0 8px}.muted{color:#6b7280}.pie-wrap{display:flex;align-items:center;gap:24px}.pie-wrap svg{width:240px;height:240px;flex:0 0 240px}.legend{flex:1;display:grid;gap:10px}
    .legend-item{display:grid;grid-template-columns:16px 1fr auto;align-items:center;gap:8px;color:#374151}.dot{display:inline-block;width:10px;height:10px;border-radius:999px;margin-right:8px;vertical-align:middle}
    .chart-segment{cursor:pointer;transform-origin:120px 120px;transition:transform .18s ease,filter .18s ease,opacity .18s ease}.chart-segment:hover{transform:scale(1.035);filter:drop-shadow(0 9px 12px rgba(15,23,42,.2));opacity:.94}
    .compare-row{padding:12px 0;border-bottom:1px solid #eef2f7;border-radius:10px;transition:background .18s ease,transform .18s ease,box-shadow .18s ease}.compare-row:hover{background:#f8fafc;transform:translateY(-1px);box-shadow:0 10px 22px rgba(15,23,42,.06);padding-left:10px;padding-right:10px}
    .compare-label{display:flex;justify-content:space-between;font-weight:700}.bar-line{display:grid;grid-template-columns:48px 1fr 48px;gap:8px;align-items:center;margin-top:8px;font-size:12px;color:#6b7280}
    .bar-bg{height:9px;background:#eef2ff;border-radius:999px;overflow:hidden}.bar-bg i{display:block;height:100%;border-radius:999px;transition:width .35s ease,filter .18s ease}.compare-row:hover .bar-bg i{filter:saturate(1.25)}.bar-line.target .bar-bg i{background:#94a3b8}.positive{color:#dc2626}.negative{color:#059669}
    table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:10px 8px;border-bottom:1px solid #eef2f7;text-align:left}th{font-size:12px;color:#64748b;background:#f8fafc}td:nth-child(n+2),th:nth-child(n+2){text-align:right}
    .pill{border-radius:999px;padding:3px 8px;font-size:12px}.pill.over{background:#fef2f2;color:#dc2626}.pill.under{background:#fffbeb;color:#b45309}.pill.near{background:#ecfdf5;color:#047857}
    .analysis{font-size:15px;color:#374151}.analysis ul{margin:8px 0 0;padding-left:20px}.analysis h3{margin-top:18px}.ai-box{border-left:4px solid #2563eb;background:#eff6ff;border-radius:12px;padding:16px;margin-bottom:16px}.full{grid-column:1/-1}.empty-chart{height:240px;display:flex;align-items:center;justify-content:center;color:#64748b;background:#f8fafc;border-radius:12px}
    .floating-tooltip{position:fixed;z-index:9999;pointer-events:none;background:#111827;color:#fff;padding:8px 10px;border-radius:8px;font-size:12px;box-shadow:0 12px 28px rgba(15,23,42,.25);opacity:0;transform:translateY(4px);transition:opacity .12s ease,transform .12s ease;max-width:280px}.floating-tooltip.show{opacity:1;transform:translateY(0)}
    @media(max-width:860px){.grid,.stats{grid-template-columns:1fr}.pie-wrap{flex-direction:column;align-items:flex-start}.page{padding:18px}.hero h1{font-size:26px}}
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <h1>\u8d44\u4ea7\u914d\u7f6e\u5206\u6790\u62a5\u544a</h1>
      <p>\u57fa\u4e8e\u5f53\u524d\u6301\u4ed3\u3001\u76ee\u6807\u7b56\u7565\u548c\u5e02\u503c\u6298\u7b97\u751f\u6210\u3002\u6570\u636e\u65f6\u70b9\uff1a${escapeHtml(reportDate)}</p>
      <div class="stats">
        <div class="stat"><span>\u603b\u8d44\u4ea7</span><strong>${formatCurrency(total)}</strong></div>
        <div class="stat"><span>\u6301\u4ed3\u6570</span><strong>${assets.length}</strong></div>
        <div class="stat"><span>\u76ee\u6807\u7b56\u7565</span><strong>${escapeHtml(strategyName)}</strong></div>
        <div class="stat"><span>\u98ce\u9669\u6807\u7b7e</span><strong>${escapeHtml(riskLevel)}</strong></div>
      </div>
    </section>
    <div class="grid">
      <section class="card">
        <h2>\u5f53\u524d\u6301\u4ed3\u5206\u5e03</h2>
        ${buildPieSvg(rows)}
      </section>
      <section class="card">
        <h2>\u76ee\u6807\u4e0e\u5f53\u524d\u5bf9\u6bd4</h2>
        ${buildComparisonBars(rows)}
      </section>
      <section class="card full analysis">
        <h2>\u6838\u5fc3\u7ed3\u8bba</h2>
        ${aiAnalysisHtml ? `<div class="ai-box">${aiAnalysisHtml}</div>` : ''}
        <p>\u5f53\u524d\u7ec4\u5408\u603b\u8d44\u4ea7\u4e3a <strong>${formatCurrency(total)}</strong>\uff0c\u6b63\u5728\u5bf9\u7167\u201c${escapeHtml(strategyName)}\u201d\u8fdb\u884c\u5206\u6790\u3002${escapeHtml(strategyDesc)}</p>
        <p>\u4e3b\u8981\u914d\u7f6e\u5dee\u8ddd\uff1a${gapSummary}\u3002</p>
        <h3>\u98ce\u9669\u4e0e\u5173\u6ce8\u70b9</h3>
        <ul>${(riskNotes.length ? riskNotes : ['\u5f53\u524d\u672a\u8bc6\u522b\u5230\u660e\u663e\u5355\u9879\u98ce\u9669\uff0c\u4f46\u4ecd\u5efa\u8bae\u7ed3\u5408\u6295\u8d44\u671f\u9650\u548c\u73b0\u91d1\u6d41\u9700\u6c42\u5b9a\u671f\u590d\u76d8\u3002']).map((item) => `<li>${item}</li>`).join('')}</ul>
        <h3>\u53ef\u9009\u8c03\u6574\u65b9\u5411</h3>
        <p>\u53ef\u4ee5\u5148\u4ece\u504f\u79bb\u6700\u5927\u7684\u8d44\u4ea7\u7c7b\u522b\u5165\u624b\uff0c\u901a\u8fc7\u540e\u7eed\u589e\u91cf\u8d44\u91d1\u3001\u5b9a\u671f\u590d\u76d8\u548c\u5206\u6279\u8c03\u6574\u6765\u9010\u6b65\u9760\u8fd1\u76ee\u6807\uff0c\u907f\u514d\u4e00\u6b21\u6027\u5927\u5e45\u5ea6\u64cd\u4f5c\u3002</p>
      </section>
      <section class="card full">
        <h2>\u914d\u7f6e\u5dee\u8ddd\u8868</h2>
        <table><thead><tr><th>\u7c7b\u522b</th><th>\u5f53\u524d\u91d1\u989d</th><th>\u5f53\u524d\u5360\u6bd4</th><th>\u76ee\u6807\u5360\u6bd4</th><th>\u5dee\u8ddd</th><th>\u72b6\u6001</th></tr></thead><tbody>${gapRows}</tbody></table>
      </section>
      <section class="card full">
        <h2>\u4e3b\u8981\u6301\u4ed3</h2>
        <table><thead><tr><th>\u540d\u79f0</th><th>\u7c7b\u578b</th><th>\u4ee3\u7801</th><th>\u5f53\u524d\u4ef7\u503c</th><th>\u7ec4\u5408\u5360\u6bd4</th><th>\u5e01\u79cd</th></tr></thead><tbody>${holdingRows}</tbody></table>
      </section>
    </div>
  </main>
  <div class="floating-tooltip" id="chartTooltip"></div>
  <script>
    (function(){
      var tooltip = document.getElementById('chartTooltip');
      if (!tooltip) return;
      function move(event){
        tooltip.style.left = Math.min(window.innerWidth - 300, event.clientX + 14) + 'px';
        tooltip.style.top = Math.max(12, event.clientY + 14) + 'px';
      }
      document.querySelectorAll('[data-tooltip]').forEach(function(node){
        node.addEventListener('mouseenter', function(event){
          tooltip.textContent = node.getAttribute('data-tooltip') || '';
          tooltip.classList.add('show');
          move(event);
        });
        node.addEventListener('mousemove', move);
        node.addEventListener('mouseleave', function(){
          tooltip.classList.remove('show');
        });
      });
    })();
  </script>
</body>
</html>`;
}

export function AIStrategyAssistant({ open, onClose, selectedStrategy, allocationRows }: AIStrategyAssistantProps) {
  const { assets, loadAssets } = useAssetStore();
  const [tab, setTab] = useState<'advice' | 'image' | 'report'>('advice');
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadStoredMessages());
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [extractedRows, setExtractedRows] = useState<ExtractedHolding[]>([]);
  const [selectedRows, setSelectedRows] = useState<Record<number, boolean>>({});

  const summary = useMemo(() => {
    const total = assets.reduce((sum, asset) => sum + Number(asset.current_value_cny || 0), 0);
    return { total, count: assets.length };
  }, [assets]);

  const selectedCount = useMemo(
    () => extractedRows.filter((_, index) => selectedRows[index]).length,
    [extractedRows, selectedRows],
  );

  const reportRows = useMemo(() => normalizeReportRows(allocationRows), [allocationRows]);

  const biggestReportGaps = useMemo(
    () => [...reportRows].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 4),
    [reportRows],
  );

  useEffect(() => {
    window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
  }, [messages]);

  if (!open) return null;

  const generateAdvice = async () => {
    const userText = prompt.trim() || TEXT.defaultPrompt;
    const history = messages
      .slice(-MAX_HISTORY_MESSAGES)
      .map((message) => ({ role: message.role, content: message.content }));
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: userText };
    setMessages((prev) => [...prev, userMessage].slice(-MAX_STORED_MESSAGES));
    setPrompt('');
    setLoadingAdvice(true);
    setError('');

    try {
      const payload: StrategyAdviceRequest = {
        selected_strategy: (selectedStrategy && typeof selectedStrategy === 'object' ? selectedStrategy : {}) as Record<string, unknown>,
        allocation_rows: allocationRows,
        custom_context: userText,
        chat_history: [...history, { role: 'user', content: userText }],
      };
      const result = await api.strategyAdvice(payload);
      const notes = [
        result.advice_markdown,
        result.risk_flags?.length ? `\n\n\u98ce\u9669\u63d0\u793a\uff1a\n${result.risk_flags.map((item) => `- ${item}`).join('\n')}` : '',
        result.rebalance_notes?.length ? `\n\n\u53ef\u9009\u8c03\u6574\u65b9\u5411\uff1a\n${result.rebalance_notes.map((item) => `- ${item}`).join('\n')}` : '',
      ].join('');
      const assistantMessage: ChatMessage = { id: `assistant-${Date.now()}`, role: 'assistant', content: notes };
      setMessages((prev) => [...prev, assistantMessage].slice(-MAX_STORED_MESSAGES));
    } catch (err: unknown) {
      setError(getErrorMessage(err, TEXT.adviceError));
    } finally {
      setLoadingAdvice(false);
    }
  };

  const generateHtmlReport = async () => {
    if (assets.length === 0) {
      setError(TEXT.reportEmpty);
      return;
    }
    setError('');
    setLoadingReport(true);
    try {
      const result = await api.strategyAdvice({
        selected_strategy: (selectedStrategy && typeof selectedStrategy === 'object' ? selectedStrategy : {}) as Record<string, unknown>,
        allocation_rows: allocationRows,
        custom_context:
          '\u8bf7\u4e3a\u4e00\u4efd\u0048\u0054\u004d\u004c\u8d44\u4ea7\u5206\u6790\u62a5\u544a\u751f\u6210\u201c\u6838\u5fc3\u7ed3\u8bba\u201d\u90e8\u5206\uff1a\u9700\u8981\u6df1\u5ea6\u4f46\u7b80\u6d01\u3001\u4e13\u4e1a\u3001\u514b\u5236\uff0c\u805a\u7126\u5f53\u524d\u914d\u7f6e\u3001\u76ee\u6807\u7b56\u7565\u504f\u79bb\u3001\u4e3b\u8981\u98ce\u9669\u548c\u53ef\u9009\u8c03\u6574\u65b9\u5411\u3002\u8bf7\u7528\u4e2d\u6587 Markdown\uff0c\u4e0d\u8981\u5199\u6295\u8d44\u5efa\u8bae\u514d\u8d23\u58f0\u660e\uff0c\u4e0d\u8981\u8f93\u51fa JSON \u8bf4\u660e\u3002',
        chat_history: [],
      });
      const aiAnalysis = [
        result.advice_markdown,
        result.risk_flags?.length ? `\n\n\u98ce\u9669\u63d0\u793a\uff1a\n${result.risk_flags.map((item) => `- ${item}`).join('\n')}` : '',
        result.rebalance_notes?.length ? `\n\n\u53ef\u9009\u8c03\u6574\u65b9\u5411\uff1a\n${result.rebalance_notes.map((item) => `- ${item}`).join('\n')}` : '',
      ].join('');
      const html = buildReportHtml(assets, reportRows, selectedStrategy, aiAnalysis);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      anchor.href = url;
      anchor.download = `portfolio_analysis_report_${date}.html`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(getErrorMessage(err, TEXT.adviceError));
    } finally {
      setLoadingReport(false);
    }
  };

  const handleImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoadingImage(true);
    setError('');

    try {
      const dataUrl = await fileToDataUrl(file);
      const result = await api.extractHoldingsImage(dataUrl);
      const rows = result.holdings.map(normalizeHolding);
      setExtractedRows(rows);
      setSelectedRows(Object.fromEntries(rows.map((_, index) => [index, true])));
    } catch (err: unknown) {
      setError(getErrorMessage(err, TEXT.imageError));
    } finally {
      setLoadingImage(false);
      event.target.value = '';
    }
  };

  const updateRow = (index: number, patch: Partial<ExtractedHolding>) => {
    setExtractedRows((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  const selectAllRows = () => {
    setSelectedRows(Object.fromEntries(extractedRows.map((_, index) => [index, true])));
  };

  const clearSelectedRows = () => {
    setSelectedRows({});
  };

  const deleteSelectedRows = () => {
    const nextRows = extractedRows.filter((_, index) => !selectedRows[index]);
    setExtractedRows(nextRows);
    setSelectedRows(Object.fromEntries(nextRows.map((_, index) => [index, true])));
  };

  const importRows = async () => {
    const rows = extractedRows.filter((_, index) => selectedRows[index]);
    if (rows.length === 0) {
      setError(TEXT.chooseOne);
      return;
    }

    setImporting(true);
    setError('');
    try {
      await api.importExtractedHoldings(rows);
      await loadAssets();
      setExtractedRows([]);
      setSelectedRows({});
    } catch (err: unknown) {
      setError(getErrorMessage(err, TEXT.importError));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink-950/40 p-4 backdrop-blur-sm">
      <div
        className="flex flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        style={{ width: '860px', maxWidth: 'calc(100vw - 64px)', height: '90vh', maxHeight: '900px' }}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-ink-950 text-white">
              <Bot size={22} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-950">{TEXT.title}</h3>
              <p className="text-sm text-gray-500">{TEXT.subtitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="custom-scrollbar flex shrink-0 overflow-x-auto border-b border-gray-100 px-4 pt-3 md:px-6 md:pt-4">
          {[
            { value: 'advice', label: TEXT.adviceTab, icon: Sparkles },
            { value: 'report', label: TEXT.reportTab, icon: FileText },
            { value: 'image', label: TEXT.imageTab, icon: FileImage },
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setTab(item.value as typeof tab)}
                className={`mr-2 inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium ${
                  active ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-800'
                }`}
              >
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </div>

        <div className={`custom-scrollbar min-h-0 flex-1 p-4 md:p-5 ${tab === 'advice' ? 'overflow-y-auto md:overflow-hidden' : 'overflow-y-auto'}`}>
          {error && <div className="mb-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

          {tab === 'advice' ? (
            <div className="grid min-h-0 grid-rows-[auto_minmax(360px,1fr)] gap-4 md:h-full md:grid-cols-[280px_minmax(0,1fr)] md:grid-rows-1 md:gap-5">
              <aside className="flex min-h-0 flex-col gap-3 overflow-visible md:overflow-hidden">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-sm text-gray-500">{TEXT.currentAssets}</div>
                  <div className="mt-1 text-2xl font-bold text-gray-950">
                    {'\u00a5'}{summary.total.toLocaleString('zh-CN')}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">{summary.count} {TEXT.holdings}</div>
                </div>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-gray-700">{TEXT.constraints}</span>
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    className="w-full resize-none rounded-lg border border-gray-200 p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    style={{ height: '130px' }}
                    placeholder={TEXT.promptPlaceholder}
                  />
                </label>

                <button
                  type="button"
                  onClick={generateAdvice}
                  disabled={loadingAdvice}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-ink-950 px-4 py-3 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-60"
                >
                  {loadingAdvice ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                  {TEXT.sendAdvice}
                </button>
              </aside>

              <section className="flex min-h-[360px] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white p-4 md:min-h-0 md:p-5">
                <div className="mb-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setMessages([])}
                    disabled={messages.length === 0 || loadingAdvice}
                    className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {TEXT.clearChat}
                  </button>
                </div>
                <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto rounded-lg border border-dashed border-gray-200 bg-gray-50 p-5">
                  {messages.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-center text-sm text-gray-500">
                      {TEXT.chatEmpty}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {messages.map((message) => (
                        <div
                          key={message.id}
                          className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                              message.role === 'user'
                                ? 'rounded-br-sm bg-brand-600 text-white'
                                : 'rounded-bl-sm border border-gray-100 bg-white text-gray-800'
                            }`}
                          >
                            <div className="mb-1 text-xs opacity-70">{message.role === 'user' ? TEXT.you : TEXT.assistant}</div>
                            <div className="whitespace-pre-wrap">{message.content}</div>
                          </div>
                        </div>
                      ))}
                      {loadingAdvice && (
                        <div className="flex justify-start">
                          <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm border border-gray-100 bg-white px-4 py-3 text-sm text-gray-500 shadow-sm">
                            <Loader2 className="animate-spin" size={16} />
                            {TEXT.thinking}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            </div>
          ) : tab === 'report' ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 p-5">
                <div>
                  <div className="font-semibold text-gray-950">{TEXT.reportTitle}</div>
                  <div className="mt-1 max-w-xl text-sm leading-6 text-gray-500">{TEXT.reportDesc}</div>
                  <div className="mt-2 text-xs text-gray-400">{TEXT.reportFormat}</div>
                </div>
                <button
                  type="button"
                  onClick={generateHtmlReport}
                  disabled={assets.length === 0 || loadingReport}
                  className="inline-flex items-center gap-2 rounded-md bg-ink-950 px-4 py-3 text-sm font-semibold text-white hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingReport ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
                  {loadingReport ? TEXT.reportGenerating : TEXT.generateReport}
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="text-sm text-gray-500">{TEXT.currentAssets}</div>
                  <div className="mt-1 text-2xl font-bold text-gray-950">{'\u00a5'}{summary.total.toLocaleString('zh-CN')}</div>
                  <div className="mt-1 text-xs text-gray-500">{summary.count} {TEXT.holdings}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-4 md:col-span-2">
                  <div className="text-sm font-medium text-gray-700">{'\u62a5\u544a\u5c06\u5305\u542b'}</div>
                  <div className="mt-2 grid gap-2 text-sm text-gray-500 sm:grid-cols-2">
                    <span>{'\u2022 \u8d44\u4ea7\u7c7b\u522b\u997c\u56fe'}</span>
                    <span>{'\u2022 \u76ee\u6807\u4e0e\u5f53\u524d\u5360\u6bd4\u5bf9\u6bd4'}</span>
                    <span>{'\u2022 \u4e3b\u8981\u504f\u79bb\u548c\u98ce\u9669\u70b9'}</span>
                    <span>{'\u2022 \u4e3b\u8981\u6301\u4ed3\u660e\u7ec6'}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="mb-3 font-semibold text-gray-950">{'\u4e3b\u8981\u7b56\u7565\u5dee\u8ddd\u9884\u89c8'}</div>
                <div className="space-y-3">
                  {biggestReportGaps.map((row) => (
                    <div key={row.type} className="grid grid-cols-[88px_minmax(0,1fr)_64px] items-center gap-3 text-sm">
                      <div className="flex items-center gap-2 font-medium text-gray-700">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                        {row.label}
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, Math.max(0, row.currentPercent)).toFixed(2)}%`,
                            backgroundColor: row.color,
                          }}
                        />
                      </div>
                      <div className={`text-right font-semibold ${row.gap >= 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                        {formatPercent(row.gap)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div>
                  <div className="font-semibold text-gray-950">{TEXT.uploadTitle}</div>
                  <div className="mt-1 text-sm text-gray-500">{TEXT.uploadDesc}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllRows}
                    disabled={extractedRows.length === 0}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    {TEXT.selectAll}
                  </button>
                  <button
                    type="button"
                    onClick={clearSelectedRows}
                    disabled={extractedRows.length === 0}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    {TEXT.clearAll}
                  </button>
                  <button
                    type="button"
                    onClick={deleteSelectedRows}
                    disabled={selectedCount === 0}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-100 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                  >
                    <Trash2 size={15} />
                    {TEXT.deleteSelected}
                  </button>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-ink-950 px-4 py-3 text-sm font-semibold text-white hover:bg-ink-800">
                    {loadingImage ? <Loader2 className="animate-spin" size={16} /> : <FileImage size={16} />}
                    {TEXT.chooseImage}
                    <input type="file" accept="image/*" className="hidden" onChange={handleImage} />
                  </label>
                </div>
              </div>

              {extractedRows.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-[1100px] w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500">
                      <tr>
                        {tableHeaders.map((header) => (
                          <th key={header} className="px-3 py-3">{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {extractedRows.map((row, index) => (
                        <tr key={index}>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={Boolean(selectedRows[index])}
                              onChange={(event) => setSelectedRows((prev) => ({ ...prev, [index]: event.target.checked }))}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={row.type}
                              onChange={(event) => updateRow(index, { type: event.target.value })}
                              className="h-9 rounded-md border border-gray-200 px-2"
                            >
                              {assetTypeOptions.map((type) => (
                                <option key={type} value={type}>{ASSET_CONFIG[type].label}</option>
                              ))}
                            </select>
                          </td>
                          {(['market', 'symbol', 'name', 'quantity', 'unit_price', 'current_price', 'currency', 'exchange_rate_to_cny'] as const).map((field) => (
                            <td key={field} className="px-3 py-2">
                              <input
                                value={row[field] === null || row[field] === undefined ? '' : String(row[field])}
                                onChange={(event) => updateRow(index, {
                                  [field]: ['quantity', 'unit_price', 'current_price', 'exchange_rate_to_cny'].includes(field)
                                    ? Number(event.target.value || 0)
                                    : event.target.value,
                                })}
                                className="h-9 w-full rounded-md border border-gray-200 px-2"
                              />
                            </td>
                          ))}
                          <td className="px-3 py-2 text-gray-600">
                            {row.confidence === null || row.confidence === undefined ? '-' : `${Math.round(row.confidence * 100)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex h-72 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500">
                  {TEXT.tableEmpty}
                </div>
              )}

              {extractedRows.length > 0 && (
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-500">{TEXT.selectedCount} {selectedCount} / {extractedRows.length} {TEXT.rowUnit}</div>
                  <button
                    type="button"
                    onClick={importRows}
                    disabled={importing}
                    className="inline-flex items-center gap-2 rounded-md bg-ink-950 px-4 py-3 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-60"
                  >
                    {importing ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                    {TEXT.confirmImport}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-gray-100 px-6 py-3 text-xs text-gray-500">
          <CheckCircle2 size={14} className="text-emerald-600" />
          {TEXT.footer}
        </div>
      </div>
    </div>
  );
}
