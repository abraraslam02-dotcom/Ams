import React, { useState } from 'react';
import { Database, Key, Link2, ListTree, ShieldAlert, CheckCircle2, Search, Table as TableIcon } from 'lucide-react';
import { TableDetail } from '../../types/database';

interface SchemaExplorerViewProps {
  tables: TableDetail[];
}

export const SchemaExplorerView: React.FC<SchemaExplorerViewProps> = ({ tables }) => {
  const [selectedTableName, setSelectedTableName] = useState<string>(
    tables.length > 0 ? tables[0].name : 'items'
  );
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredTables = tables.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedTable = tables.find((t) => t.name === selectedTableName) || tables[0];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-600" />
            Database Schema & Relational Structure Registry
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time introspection of all {tables.length} tables in <code className="font-mono text-slate-700 bg-slate-100 px-1 py-0.5 rounded">ams_medical.db</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
            Foreign Keys Enforced
          </span>
          <span className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 border border-slate-200">
            WAL Mode Active
          </span>
        </div>
      </div>

      {/* Main Two-Column Explorer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Table Selector List */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Tables ({filteredTables.length})
            </span>
            <span className="text-[10px] text-slate-400 font-mono">SQLite Engine</span>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter tables..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div className="space-y-1 max-h-[560px] overflow-y-auto pr-1">
            {filteredTables.map((table) => {
              const isSelected = table.name === selectedTableName;
              return (
                <button
                  key={table.name}
                  onClick={() => setSelectedTableName(table.name)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <TableIcon
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isSelected ? 'text-white' : 'text-slate-400'
                      }`}
                    />
                    <span className="text-xs font-mono font-medium truncate">
                      {table.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                        isSelected
                          ? 'bg-emerald-700/80 text-white'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {table.columnsCount} cols
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        isSelected
                          ? 'bg-white/20 text-white'
                          : table.rowCount === 0
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-blue-50 text-blue-700'
                      }`}
                      title={table.rowCount === 0 ? 'Zero dummy records (Strictly clean)' : `${table.rowCount} records`}
                    >
                      {table.rowCount === 0 ? '0 fake' : `${table.rowCount} rec`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Selected Table Schema Details */}
        <div className="lg:col-span-8 space-y-4">
          {selectedTable ? (
            <>
              {/* Table Summary Card */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                      <TableIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900 font-mono">
                        {selectedTable.name}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {selectedTable.columnsCount} Columns • {selectedTable.foreignKeys.length} Foreign Key Constraints • {selectedTable.indexes.length} Indexes
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      {selectedTable.rowCount === 0
                        ? 'Zero Fake Records (Clean)'
                        : `${selectedTable.rowCount} Record (Store Config)`}
                    </span>
                  </div>
                </div>

                {/* Columns Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-400 font-semibold uppercase text-[10px] tracking-wider">
                        <th className="py-2 px-2.5">Key</th>
                        <th className="py-2 px-2.5">Column Name</th>
                        <th className="py-2 px-2.5">Type</th>
                        <th className="py-2 px-2.5">Nullability</th>
                        <th className="py-2 px-2.5">Default Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedTable.columns.map((col) => (
                        <tr key={col.name} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-2 px-2.5">
                            {col.isPrimary ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">
                                <Key className="w-2.5 h-2.5" /> PK
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="py-2 px-2.5 font-mono font-semibold text-slate-800">
                            {col.name}
                          </td>
                          <td className="py-2 px-2.5">
                            <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                              {col.type}
                            </span>
                          </td>
                          <td className="py-2 px-2.5">
                            {col.nullable ? (
                              <span className="text-slate-400">NULL</span>
                            ) : (
                              <span className="text-emerald-700 font-semibold">NOT NULL</span>
                            )}
                          </td>
                          <td className="py-2 px-2.5 font-mono text-[11px] text-slate-500">
                            {col.defaultValue !== null && col.defaultValue !== undefined
                              ? String(col.defaultValue)
                              : 'None'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Foreign Keys & Indexes Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Foreign Keys */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 uppercase tracking-wider">
                    <Link2 className="w-4 h-4 text-emerald-600" />
                    <span>Foreign Key Constraints ({selectedTable.foreignKeys.length})</span>
                  </div>
                  {selectedTable.foreignKeys.length > 0 ? (
                    <div className="space-y-1.5">
                      {selectedTable.foreignKeys.map((fk, idx) => (
                        <div
                          key={idx}
                          className="p-2 rounded-lg bg-slate-50 border border-slate-100 text-xs font-mono flex items-center justify-between"
                        >
                          <span className="text-slate-800 font-semibold">{fk.fromColumn}</span>
                          <span className="text-slate-400">→</span>
                          <span className="text-emerald-700 font-semibold">
                            {fk.targetTable}({fk.targetColumn})
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 italic">No external foreign keys on this table.</p>
                  )}
                </div>

                {/* Indexes */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 uppercase tracking-wider">
                    <ListTree className="w-4 h-4 text-teal-600" />
                    <span>Indexes ({selectedTable.indexes.length})</span>
                  </div>
                  {selectedTable.indexes.length > 0 ? (
                    <div className="space-y-1.5">
                      {selectedTable.indexes.map((idxName) => (
                        <div
                          key={idxName}
                          className="p-2 rounded-lg bg-slate-50 border border-slate-100 text-xs font-mono text-slate-700"
                        >
                          {idxName}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 italic">Indexed by Primary Key automatically.</p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="p-8 text-center bg-white rounded-xl border border-slate-200 text-slate-500">
              Select a table on the left to inspect its schema.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
