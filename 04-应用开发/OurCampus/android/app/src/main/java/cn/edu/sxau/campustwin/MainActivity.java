package cn.edu.sxau.campustwin;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    @SuppressWarnings("deprecation")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The web startup animation owns the initial black surface. Once it
        // finishes, SystemBars restores the light window theme behind insets.
        getWindow().getDecorView().setBackgroundColor(Color.rgb(5, 5, 5));
        if (Build.VERSION.SDK_INT < 35) {
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
        }
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(Color.rgb(5, 5, 5));
        }
    }
}
