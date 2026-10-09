package cn.edu.sxau.campustwin;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    @SuppressWarnings("deprecation")
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(CampusPushPlugin.class);
        super.onCreate(savedInstanceState);
        // The web startup video owns the initial dark surface. Once it
        // finishes, SystemBars restores the light window theme behind insets.
        getWindow().getDecorView().setBackgroundColor(Color.rgb(14, 19, 22));
        if (Build.VERSION.SDK_INT < 35) {
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
        }
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(Color.rgb(14, 19, 22));
        }
    }
}
