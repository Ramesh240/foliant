package com.ramesh.foliant;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Capacitor plugin exposing Google Play Billing to the web app as
 * window.FoliantBilling (see js/iap.js and docs/PUBLISHING.md §6):
 *
 *   purchase() -> {ok, productId, acknowledged}   launches the Play flow
 *   restore()  -> {ok, productId, acknowledged}   queries existing purchases
 *
 * The single non-consumable product is foliant_premium ($1.99). A confirmed
 * purchase is granted by calling iapSetPremium(true, 'play') in the web
 * layer; here we only report. Non-consumables must be ACKNOWLEDGED within
 * 3 days of purchase or Play refunds them automatically — acknowledgePurchase
 * does that right after the flow (and after restore) when needed.
 */
@CapacitorPlugin(name = "FoliantBilling")
public class FoliantBillingPlugin extends Plugin {

    /* The one SKU the app sells. */
    private static final String PRODUCT_PREMIUM = "foliant_premium";
    /* Play products are type "inapp" (one-time purchases included). */
    private static final String TYPE_INAPP = "inapp";

    private BillingClient billing;
    /* Resolvers waiting for the connection established by ensureConnected(). */
    private final List<Runnable> onReady = new ArrayList<>();
    /* Resolves the purchase() call when PurchasesUpdatedListener fires. */
    private final AtomicReference<PluginCall> pendingPurchase = new AtomicReference<>(null);
    private final Handler main = new Handler(Looper.getMainLooper());

    private boolean connected = false;

    /* ---------- Connection ---------- */

    private BillingClient client() {
        if (billing == null) {
            billing = BillingClient.newBuilder(getContext())
                .setListener(purchasesUpdated())
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .build();
        }
        return billing;
    }

    /* Runs r once the billing client is connected; resolves the current call
       with an error if the Play Store cannot be reached. */
    private void ensureConnected(PluginCall call, Runnable r) {
        if (connected) { r.run(); return; }
        client().startConnection(new BillingClientStateListener() {
            @Override public void onBillingSetupFinished(BillingResult br) {
                main.post(() -> {
                    if (br.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                        connected = true;
                        r.run();
                    } else {
                        call.reject(playMessage(br.getResponseCode()));
                    }
                });
            }
            @Override public void onBillingServiceDisconnected() { connected = false; }
        });
    }

    /* ---------- JS API ---------- */

    /* Launch the Google Play purchase flow for foliant_premium. */
    @PluginMethod
    public void purchase(PluginCall call) {
        ensureConnected(call, () -> {
            QueryProductDetailsParams.Product p = QueryProductDetailsParams.Product.newBuilder()
                .setProductId(PRODUCT_PREMIUM)
                .setProductType(TYPE_INAPP)
                .build();
            client().queryProductDetailsAsync(
                QueryProductDetailsParams.newBuilder().setProductList(Collections.singletonList(p)).build(),
                (result, details) -> main.post(() -> {
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK
                            || details == null || details.isEmpty()) {
                        call.reject(playMessage(result.getResponseCode()));
                        return;
                    }
                    pendingPurchase.set(call);
                    BillingFlowParams.ProductDetailsParams.Builder dp =
                        BillingFlowParams.ProductDetailsParams.newBuilder()
                            .setProductDetails(details.get(0));
                    /* One-time products carry no offer token; only subscriptions do. */
                    if (details.get(0).getSubscriptionOfferDetails() != null
                            && !details.get(0).getSubscriptionOfferDetails().isEmpty()) {
                        dp.setOfferToken(details.get(0).getSubscriptionOfferDetails().get(0).getOfferToken());
                    }
                    client().launchBillingFlow(getActivity(),
                        BillingFlowParams.newBuilder()
                            .setProductDetailsParamsList(Collections.singletonList(dp.build()))
                            .build());
                }));
        });
    }

    /* Look up an existing entitlement for this Google account. */
    @PluginMethod
    public void restore(PluginCall call) {
        ensureConnected(call, () -> {
            client().queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(TYPE_INAPP).build(),
                (result, purchases) -> main.post(() -> {
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                        call.reject(playMessage(result.getResponseCode()));
                        return;
                    }
                    Purchase found = null;
                    if (purchases != null) {
                        for (Purchase pu : purchases) {
                            if (pu.getProducts().contains(PRODUCT_PREMIUM)
                                    && pu.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                                found = pu;
                                break;
                            }
                        }
                    }
                    if (found == null) {
                        JSObject none = new JSObject();
                        none.put("ok", false);
                        call.resolve(none);
                        return;
                    }
                    acknowledgeIfNeeded(found);
                    JSObject ok = new JSObject();
                    ok.put("ok", true);
                    ok.put("productId", PRODUCT_PREMIUM);
                    ok.put("acknowledged", found.isAcknowledged());
                    call.resolve(ok);
                }));
        });
    }

    /* ---------- Purchase flow callback ---------- */

    /* Resolves the pending purchase() call and acknowledges one-time buys. */
    private PurchasesUpdatedListener purchasesUpdated() {
        return (result, purchases) -> main.post(() -> {
            PluginCall call = pendingPurchase.getAndSet(null);
            int code = result.getResponseCode();
            if (code != BillingClient.BillingResponseCode.OK) {
                if (call != null) call.reject(playMessage(code));
                return;
            }
            boolean granted = false;
            if (purchases != null) {
                for (Purchase pu : purchases) {
                    if (pu.getProducts().contains(PRODUCT_PREMIUM)
                            && pu.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                        granted = true;
                        acknowledgeIfNeeded(pu);
                    }
                }
            }
            if (call == null) return;   // flow driven elsewhere (e.g. Play restore)
            JSObject res = new JSObject();
            res.put("ok", granted);
            if (granted) res.put("productId", PRODUCT_PREMIUM);
            call.resolve(res);
        });
    }

    /* One-time purchases must be acknowledged to Play within 3 days or the
       purchase is auto-refunded; do it the moment we see an unacknowledged one. */
    private void acknowledgeIfNeeded(Purchase pu) {
        if (pu.isAcknowledged() || pu.getPurchaseToken() == null) return;
        client().acknowledgePurchase(
            AcknowledgePurchaseParams.newBuilder()
                .setPurchaseToken(pu.getPurchaseToken())
                .build(),
            (result) -> { /* best effort; next restore() retries */ });
    }

    /* ---------- Error text ---------- */

    private String playMessage(int code) {
        switch (code) {
            case BillingClient.BillingResponseCode.USER_CANCELED:
                return "Purchase canceled.";
            case BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED:
                return "You already own Foliant Premium.";
            case BillingClient.BillingResponseCode.ITEM_UNAVAILABLE:
                return "Premium is not available in this store yet.";
            case BillingClient.BillingResponseCode.BILLING_UNAVAILABLE:
                return "Google Play is not available on this device.";
            default:
                return "Could not reach Google Play (code " + code + ").";
        }
    }
}
