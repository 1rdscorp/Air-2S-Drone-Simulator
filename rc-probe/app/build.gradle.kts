import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The DJI app key comes from the environment (CI secret) or from rc-probe/dji.properties
// (local, never committed). Without it the "dji" build still compiles, but its DJI probe
// reports that the key is missing.
val djiAppKey: String = run {
    val fromEnvironment = System.getenv("DJI_APP_KEY").orEmpty().trim()
    if (fromEnvironment.isNotEmpty()) {
        fromEnvironment
    } else {
        val file = rootProject.file("dji.properties")
        if (file.exists()) {
            Properties().apply { file.inputStream().use(::load) }
                .getProperty("DJI_APP_KEY", "").trim()
        } else {
            ""
        }
    }
}

android {
    namespace = "com.air2ssim.rcprobe"
    compileSdk = 35
    // The DJI SDK still uses Android's old HTTP classes.
    useLibrary("org.apache.http.legacy")

    defaultConfig {
        // The DJI app key is tied to this name. Do not change it without a new key.
        applicationId = "com.air2ssim.rcprobe"
        // The Smart Controller (RM500) runs Android 7.1, which is API 25.
        minSdk = 24
        // Kept at 30: the highest level the DJI Mobile SDK v4 was released for.
        targetSdk = 30
        versionCode = 1
        versionName = "1.0"
    }

    buildFeatures {
        buildConfig = true
    }

    flavorDimensions += "sdk"
    productFlavors {
        // Small app without the DJI SDK: probes 1 and 2. Needs no DJI account.
        create("plain") {
            dimension = "sdk"
            // Its own name, so that both builds can be installed side by side.
            applicationIdSuffix = ".small"
            buildConfigField("boolean", "DJI_KEY_PRESENT", "false")
        }
        // The same app plus the DJI Mobile SDK v4: probe 3. Needs a DJI app key.
        create("dji") {
            dimension = "sdk"
            versionNameSuffix = "-dji"
            buildConfigField("boolean", "DJI_KEY_PRESENT", djiAppKey.isNotEmpty().toString())
            manifestPlaceholders["djiAppKey"] = djiAppKey
            ndk {
                abiFilters += listOf("armeabi-v7a", "arm64-v8a")
            }
        }
    }

    buildTypes {
        // Only debug builds are made: they are signed automatically and can be installed
        // directly. Nothing is shrunk or obfuscated, which the DJI SDK would not survive.
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        // From DJI's integration guide for the Mobile SDK v4: these libraries must not be
        // stripped, and some files exist in more than one of the SDK's parts.
        jniLibs {
            keepDebugSymbols += listOf(
                "*/*/libdjivideo.so",
                "*/*/libSDKRelativeJNI.so",
                "*/*/libFlyForbid.so",
                "*/*/libduml_vision_bokeh.so",
                "*/*/libyuv2.so",
                "*/*/libGroudStation.so",
                "*/*/libFRCorkscrew.so",
                "*/*/libUpgradeVerify.so",
                "*/*/libFR.so",
                "*/*/libDJIFlySafeCore.so",
                "*/*/libdjifs_jni.so",
                "*/*/libsfjni.so",
                "*/*/libDJICommonJNI.so",
                "*/*/libDJICSDKCommon.so",
                "*/*/libDJIUpgradeCore.so",
                "*/*/libDJIUpgradeJNI.so",
                "*/*/libDJIWaypointV2Core.so",
                "*/*/libAMapSDK_MAP_v6_9_2.so",
                "*/*/libDJIMOP.so",
                "*/*/libDJISDKLOGJNI.so",
            )
            pickFirsts += listOf(
                "lib/*/libstlport_shared.so",
                "lib/*/libRoadLineRebuildAPI.so",
                "lib/*/libGNaviUtils.so",
                "lib/*/libGNaviMapex.so",
                "lib/*/libGNaviData.so",
                "lib/*/libGNaviMap.so",
                "lib/*/libGNaviSearch.so",
            )
            // The DJI SDK unpacks its own libraries at start-up and needs them as files.
            useLegacyPackaging = true
        }
        resources {
            excludes += listOf(
                "META-INF/rxjava.properties",
                "assets/location_map_gps_locked.png",
                "assets/location_map_gps_3d.png",
            )
        }
    }

    lint {
        disable += listOf(
            // targetSdk 30 and every version in this project are pinned on purpose.
            "ExpiredTargetSdkVersion",
            "OldTargetApi",
            "GradleDependency",
            "NewerVersionAvailable",
            "AndroidGradlePluginVersion",
            // A test tool for one device, in English only.
            "SetTextI18n",
            "ChromeOsAbiSupport",
            "Overdraw",
            // Findings inside DJI's SDK and the libraries it brings along, which cannot
            // be changed here: old-style native libraries, an old Bouncy Castle, and the
            // storage permission the SDK asks for on old Android versions.
            "Aligned16KB",
            "TrustAllX509TrustManager",
            "ScopedStorage",
        )
        abortOnError = true
        warningsAsErrors = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
        // Lets the screen itself be started in a unit test (Robolectric).
        unitTests.isIncludeAndroidResources = true
    }
}

// Java 17 bytecode, built with whatever JDK (17 or newer) runs Gradle.
kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    // As in DJI's own sample app for SDK 4.18: the same exclusion, and the Android
    // libraries the SDK's packed code and its own screens are built against. The app does
    // not build without the first two; the others are there because the code that would
    // miss them only runs on the controller, where a missing library cannot be seen from here.
    "djiImplementation"("com.dji:dji-sdk:4.18") {
        exclude(module = "library-anti-distortion")
    }
    "djiCompileOnly"("com.dji:dji-sdk-provided:4.18")
    "djiImplementation"("androidx.appcompat:appcompat:1.7.0")
    "djiImplementation"("androidx.constraintlayout:constraintlayout:2.1.4")
    "djiImplementation"("androidx.recyclerview:recyclerview:1.3.2")
    "djiImplementation"("androidx.multidex:multidex:2.0.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
}
