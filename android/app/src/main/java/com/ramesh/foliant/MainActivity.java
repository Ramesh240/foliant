package com.ramesh.foliant;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(FoliantBillingPlugin.class);   // window.FoliantBilling (js/iap.js)
    super.onCreate(savedInstanceState);
  }
}
