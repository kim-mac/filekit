import { useEffect, useState } from 'react';

export function useObjectUrl(blob?: Blob) {
  const [objectUrl, setObjectUrl] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!blob) {
      setObjectUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(blob);
    setObjectUrl({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return objectUrl?.blob === blob ? objectUrl?.url : undefined;
}
