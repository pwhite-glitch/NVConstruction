// Open a file whose URL has to be fetched first (e.g. a Supabase signed URL).
// iOS Safari and the Capacitor iOS WebView block window.open() once an await
// has passed (it is no longer a direct tap), so open a blank window right away,
// while still inside the tap, and point it at the URL once it arrives. If no
// window could be opened, navigate the current tab instead.
//
// Call it before any await in the click handler:
//   onClick={() => openFile(async () => (await supabase.storage.from(b).createSignedUrl(p, 3600)).data?.signedUrl)}
export async function openFile(getUrl) {
  const win = window.open('', '_blank')
  let url = null
  try {
    url = await getUrl()
  } catch (err) {
    console.error('openFile:', err)
  }
  if (!url) {
    if (win) win.close()
    return null
  }
  if (win && !win.closed) win.location.href = url
  else window.location.href = url
  return url
}

// Shorthand for the common case: open a file from a Supabase storage bucket.
export function openStorageFile(supabase, bucket, path, expiresIn = 3600) {
  return openFile(async () => {
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn)
    return data?.signedUrl
  })
}
