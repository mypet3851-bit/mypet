import React from 'react';
import { Save, ToggleLeft, ToggleRight, RefreshCw, Shield } from 'lucide-react';
import { getICreditConfig, updateICreditConfig, testICreditConfig, type ICreditConfigView } from '../../../services/paymentsService';
import { toast } from 'react-hot-toast';

export function ICreditSettings() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [cfg, setCfg] = React.useState<ICreditConfigView>({
    enabled: false,
    apiUrl: 'https://icredit.rivhit.co.il/API/PaymentPageRequest.svc/GetUrl',
    transport: 'auto',
    groupPrivateToken: '',
    redirectURL: '',
    ipnURL: '',
    exemptVAT: false,
    maxPayments: 1,
    creditFromPayment: 0,
    documentLanguage: 'he',
    createToken: false,
    hideItemList: false,
    emailBcc: '',
    defaultDiscount: 0
  });

  React.useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await getICreditConfig();
        setCfg(data);
      } catch (e: any) {
        toast.error(e?.response?.data?.message || 'Failed to load iCredit settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateICreditConfig(cfg);
      toast.success('iCredit settings saved');
      const re = await getICreditConfig();
      setCfg(re);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const r = await testICreditConfig();
      if (r.ok) toast.success('iCredit configuration looks valid');
      else toast.error(r.message || 'Config invalid');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to test');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm">
      <form onSubmit={handleSave} className="p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">iCredit (Rivhit Payment Page)</h2>
          <p className="text-sm text-gray-500">Configure hosted payment page integration.</p>
        </div>

        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : (
          <>
            <div className="flex items-center justify-between border rounded-lg p-4">
              <div>
                <div className="font-medium">Enable iCredit</div>
                <div className="text-sm text-gray-500">Toggle to offer iCredit payment at checkout.</div>
              </div>
              <button type="button" onClick={() => setCfg(p=>({ ...p, enabled: !p.enabled }))} className="text-indigo-600 hover:text-indigo-700">
                {cfg.enabled ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">API URL</label>
                <input className="w-full border rounded px-3 py-2" value={cfg.apiUrl} onChange={e=> setCfg(p=>({...p, apiUrl: e.target.value}))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Transport</label>
                <select className="w-full border rounded px-3 py-2" value={cfg.transport || 'auto'} onChange={e=> setCfg(p=>({...p, transport: e.target.value as any}))}>
                  <option value="auto">Auto (JSON then SOAP)</option>
                  <option value="json">JSON only</option>
                  <option value="soap">SOAP only</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">If your tenant returns HTML "Request Error" to JSON, choose SOAP only.</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Group Private Token</label>
                <div className="relative">
                  <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input className="w-full pl-10 pr-3 border rounded px-3 py-2" value={cfg.groupPrivateToken} onChange={e=> setCfg(p=>({...p, groupPrivateToken: e.target.value}))} placeholder={cfg.groupPrivateToken === '***' ? '••••••••' : ''} />
                </div>
                <p className="text-xs text-gray-500 mt-1">Leave as *** to keep existing.</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Redirect URL</label>
                <input className="w-full border rounded px-3 py-2" value={cfg.redirectURL} onChange={e=> setCfg(p=>({...p, redirectURL: e.target.value}))} placeholder="https://yourdomain.com/payment-success" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">IPN URL</label>
                <input className="w-full border rounded px-3 py-2" value={cfg.ipnURL} onChange={e=> setCfg(p=>({...p, ipnURL: e.target.value}))} placeholder="https://yourdomain.com/api/payment/ipn" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Document Language</label>
                <select className="w-full border rounded px-3 py-2" value={cfg.documentLanguage} onChange={e=> setCfg(p=>({...p, documentLanguage: e.target.value as any}))}>
                  <option value="he">Hebrew</option>
                  <option value="en">English</option>
                  <option value="ar">Arabic</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Max Payments</label>
                <input type="number" min={1} className="w-full border rounded px-3 py-2" value={cfg.maxPayments} onChange={e=> setCfg(p=>({...p, maxPayments: Math.max(1, Number(e.target.value)||1)}))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Credit From Payment</label>
                <input type="number" min={0} className="w-full border rounded px-3 py-2" value={cfg.creditFromPayment} onChange={e=> setCfg(p=>({...p, creditFromPayment: Math.max(0, Number(e.target.value)||0)}))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Default Discount</label>
                <input type="number" min={0} step="0.01" className="w-full border rounded px-3 py-2" value={cfg.defaultDiscount} onChange={e=> setCfg(p=>({...p, defaultDiscount: Math.max(0, Number(e.target.value)||0)}))} />
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={cfg.exemptVAT} onChange={e=> setCfg(p=>({...p, exemptVAT: e.target.checked}))} />
                <span className="text-sm">Exempt VAT</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={cfg.createToken} onChange={e=> setCfg(p=>({...p, createToken: e.target.checked}))} />
                <span className="text-sm">Create Token</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={cfg.hideItemList} onChange={e=> setCfg(p=>({...p, hideItemList: e.target.checked}))} />
                <span className="text-sm">Hide Item List</span>
              </label>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">Email BCC</label>
                <input className="w-full border rounded px-3 py-2" value={cfg.emailBcc} onChange={e=> setCfg(p=>({...p, emailBcc: e.target.value}))} />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button type="submit" disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60">
                <Save className="w-5 h-5" />
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <button type="button" onClick={handleTest} disabled={testing} className="inline-flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-60">
                <RefreshCw className="w-5 h-5" />
                {testing ? 'Testing…' : 'Test Config'}
              </button>
          </div>
          </>
        )}
      </form>
    </div>
  );
}
