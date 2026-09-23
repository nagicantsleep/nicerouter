"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

function fmtK(n) {
  if (!n || n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function OverviewCards({ stats }) {
  const currentRpm = stats.currentRpm || 0;
  const peakRpm = stats.peakRpm10m !== undefined ? stats.peakRpm10m : currentRpm;
  const currentTpm = stats.currentTpm || 0;
  const peakTpm = stats.peakTpm10m !== undefined ? stats.peakTpm10m : currentTpm;

  return (
    <div className="grid min-w-0 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3 sm:gap-4">
      <Card className="flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4">
        <span className="text-text-muted text-xs uppercase font-semibold sm:text-sm">Total Requests</span>
        <span className="w-full truncate text-lg font-bold xl:text-xl" title={fmt(stats.totalRequests)}>{fmt(stats.totalRequests)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4">
        <span className="text-text-muted text-xs uppercase font-semibold sm:text-sm">Current RPM</span>
        <span className="w-full truncate text-lg font-bold text-info xl:text-xl" title={`${fmt(currentRpm)} req/min`}>
          {fmt(currentRpm)} <span className="text-xs font-normal text-text-muted">req/m</span>
        </span>
        <span className="text-[10px] text-text-muted truncate w-full" title={`Peak in 10m: ${fmt(peakRpm)}/m`}>
          Peak: {fmt(peakRpm)}/m
        </span>
      </Card>
      <Card className="flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4">
        <span className="text-text-muted text-xs uppercase font-semibold sm:text-sm">Current TPM</span>
        <span className="w-full truncate text-lg font-bold text-primary xl:text-xl" title={`${fmt(currentTpm)} tok/min`}>
          {fmtK(currentTpm)} <span className="text-xs font-normal text-text-muted">tok/m</span>
        </span>
        <span className="text-[10px] text-text-muted truncate w-full" title={`Peak in 10m: ${fmtK(peakTpm)}/m`}>
          Peak: {fmtK(peakTpm)}/m
        </span>
      </Card>
      <Card className="flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4">
        <span className="text-text-muted text-xs uppercase font-semibold sm:text-sm">Total Input Tokens</span>
        <span className="w-full truncate text-lg font-bold text-primary xl:text-xl" title={fmt(stats.totalPromptTokens)}>{fmt(stats.totalPromptTokens)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4">
        <span className="text-text-muted text-xs uppercase font-semibold sm:text-sm">Cached Tokens</span>
        <span className="w-full truncate text-lg font-bold text-info xl:text-xl" title={fmt(stats.totalCachedTokens)}>{fmt(stats.totalCachedTokens)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4">
        <span className="text-text-muted text-xs uppercase font-semibold sm:text-sm">Output Tokens</span>
        <span className="w-full truncate text-lg font-bold text-success xl:text-xl" title={fmt(stats.totalCompletionTokens)}>{fmt(stats.totalCompletionTokens)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4">
        <span className="text-text-muted text-xs uppercase font-semibold sm:text-sm">Est. Cost</span>
        <span className="w-full truncate text-lg font-bold text-warning xl:text-xl" title={`~${fmtCost(stats.totalCost)}`}>~{fmtCost(stats.totalCost)}</span>
        <span className="text-[10px] text-text-muted">Estimated billing</span>
      </Card>
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
