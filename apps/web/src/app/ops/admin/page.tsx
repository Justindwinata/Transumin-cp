'use client';

import { useEffect, useState } from 'react';
import { AdminAccountProvisioning } from '../auth-ui';
import { opsApi } from '../../../lib/ops-api';
import { errorMessage } from '../../../lib/passenger';
import type { OperatorPrincipal } from '../../../lib/ops';

export default function Page() {
  const [principal, setPrincipal] = useState<OperatorPrincipal | null>(null);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    opsApi
      .me()
      .then(setPrincipal)
      .catch((cause: unknown) => setFailure(errorMessage(cause)));
  }, []);
  if (!principal)
    return (
      <main className="ops-auth-state" role="status">
        {failure ? (
          <>
            <p role="alert">{failure}</p>
            <a href="/ops/login">Masuk kembali</a>
          </>
        ) : (
          'Memeriksa sesi admin…'
        )}
      </main>
    );
  return (
    <>
      <a href="/ops/admin/reports">Verifikasi laporan penumpang</a>
      <AdminAccountProvisioning principal={principal} />
    </>
  );
}
