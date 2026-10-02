package com.ramesh.foliant;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(FoliantBillingPlugin.class);   // window.FoliantBilling (js/iap.js)
    super.onCreate(savedInstanceState);
  }

  /* Hardware + predictive back: the Capacitor bridge has no back handling,
     so default back exits the app even while a book is open. While the
     WebView still has history to pop (the library entry pushed when a book
     opens), fire foliantBack for the JS handler (idempotent showHome) AND
     pop that entry (goBackOrForward(-1)); the system dialog needs
     dismissCaption on API 34+. goBackOrForward is synchronous, so the page
     may re-run navBack for the resulting popstate — harmless. At true
     history start the default back behaviour (minimize/exit) is preserved. */
  @Override
  public void onBackPressed() {
    WebView v = bridge != null ? bridge.getWebView() : null;
    if (v == null) { super.onBackPressed(); return; }
    if (!v.canGoBack()) { super.onBackPressed(); return; }
    v.evaluateJavascript(
        "(function(){var b=document.createEvent('Events');b.initEvent('foliantBack',true,true);" +
        "document.dispatchEvent(b);})()", null);
    v.goBackOrForward(-1);
    if (android.os.Build.VERSION.SDK_INT >= 34) v.dismissCaption(0);
  }
}
