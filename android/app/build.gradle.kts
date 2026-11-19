import java.security.MessageDigest

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "im.bottle.focus"
    compileSdk = 34
    buildToolsVersion = "34.0.0"

    defaultConfig {
        applicationId = "im.bottle.focus"
        minSdk = 26
        targetSdk = 34
        // 0.2.1 / 7：小窗时间基准重算（Bug 1）+ 计时期间的前台服务（Bug 2）
        // 0.2.2 / 8：guard.active 残留收尾三处（P1-1）+ FGS 异常安全（P2-1）+ 通知收尾（P2-2）
        // 0.2.3 / 9：正计时场次被进程重启后清拦截镜像（P1-2）+ finally 内 runCatching（P2）
        // 0.2.4 / 10：屏幕固定改成"先试再校验"（P0）+ 通知去 action（A）
        //             + 设置页删通知分组（B）+ 应用锁黑名单→白名单（C）
        // 0.2.5 / 11：暂停→继续重新上锁（P0-1）+ 复核改轮询（P0-2）+ 首问文案（P1-3）
        versionCode = 11
        versionName = "0.2.5"
    }

    // BuildConfig.VERSION_NAME / DEBUG 在代码里要用（device.info、WebView 调试开关）
    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    buildTypes {
        // v1 不混淆：省不了多少体积，却会把真机堆栈毁掉（设计 §6）
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    packaging {
        resources {
            excludes += setOf("META-INF/*.kotlin_module", "META-INF/LICENSE*", "META-INF/NOTICE*")
        }
    }
}

dependencies {
    // 只有两个依赖。WebView 干了 99% 的 UI，原生侧不到 1600 行。
    // webkit 1.12.0 的 aar-metadata 里 minCompileSdk=34，与工程 compileSdk 一致，可用。
    implementation("androidx.webkit:webkit:1.12.0")
    implementation("androidx.core:core-ktx:1.13.1")
}

// ---------------------------------------------------------------------------
// 网页产物同步与一致性校验
//
// 方案 b（设计 §6 的两种做法里选 b）：
//   1) assets/web 是工程内真实存在的目录，构建不依赖 web-src 存在（打包发出的源码包也能编译）；
//   2) 每次 preBuild 用 SHA-256 与 ../web-src/public 逐文件比对，不一致直接让构建失败。
// 这样「拷漏一个文件 → 白屏」在构建期就会暴露，而不是装上手机才发现。
// ---------------------------------------------------------------------------

// 两种目录布局都支持：仓库里是 <repo>/public（tools/build.py 的产物），
// 开发机上是 <ws>/web-src/public。取第一个存在的，避免「clone 下来编译不了」。
val webSrcDir: File = listOf(
    rootProject.projectDir.parentFile.resolve("public"),
    rootProject.projectDir.parentFile.resolve("web-src/public")
).firstOrNull { it.isDirectory }
    ?: rootProject.projectDir.parentFile.resolve("public")
val webDstDir: File = layout.projectDirectory.dir("src/main/assets/web").asFile

/** 计算文件 SHA-256（十六进制小写）。 */
fun sha256Of(file: File): String {
    val md = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
        val buf = ByteArray(64 * 1024)
        while (true) {
            val n = input.read(buf)
            if (n <= 0) break
            md.update(buf, 0, n)
        }
    }
    return md.digest().joinToString("") { "%02x".format(it) }
}

/** 显式同步：./gradlew :app:syncWeb —— 升级网页时唯一允许的拷贝入口。 */
tasks.register<Sync>("syncWeb") {
    group = "bottle"
    description = "把 ../web-src/public 整目录同步到 app/src/main/assets/web（只读源，绝不反向写）"
    onlyIf {
        val ok = webSrcDir.isDirectory
        if (!ok) logger.lifecycle("[web] 跳过 syncWeb：${webSrcDir.path} 不存在")
        ok
    }
    from(webSrcDir)
    into(webDstDir)
}

/** 构建期强制校验：assets 与 public 必须逐字节一致，否则构建失败。 */
val verifyWebAssets = tasks.register("verifyWebAssets") {
    group = "verification"
    description = "校验 app/src/main/assets/web 与 ../web-src/public 逐字节一致"
    doLast {
        if (!webSrcDir.isDirectory) {
            // 源码包脱离 monorepo 分发时没有 web-src，此时只打包已提交的 assets，不算失败。
            logger.lifecycle("[web] 未找到 ${webSrcDir.path}，跳过一致性校验（使用已提交的 assets/web）")
            return@doLast
        }
        if (!webDstDir.isDirectory) {
            throw GradleException("[web] assets/web 不存在，请先执行 ./gradlew :app:syncWeb")
        }
        val srcFiles = webSrcDir.walkTopDown().filter { it.isFile }
            .associateBy { it.relativeTo(webSrcDir).invariantSeparatorsPath }
        val dstFiles = webDstDir.walkTopDown().filter { it.isFile }
            .associateBy { it.relativeTo(webDstDir).invariantSeparatorsPath }

        val problems = mutableListOf<String>()
        (srcFiles.keys - dstFiles.keys).sorted().forEach { problems += "assets 缺少文件: $it" }
        (dstFiles.keys - srcFiles.keys).sorted().forEach { problems += "assets 多余文件: $it" }
        srcFiles.forEach { (rel, src) ->
            val dst = dstFiles[rel] ?: return@forEach
            if (sha256Of(src) != sha256Of(dst)) problems += "内容不一致: $rel"
        }

        if (problems.isNotEmpty()) {
            problems.take(30).forEach { logger.error("[web] $it") }
            throw GradleException(
                "assets/web 与 web-src/public 不一致（共 ${problems.size} 处）。" +
                    "请执行 ./gradlew :app:syncWeb 后重试。"
            )
        }
        logger.lifecycle("[web] 一致性校验通过：${srcFiles.size} 个文件逐字节一致")
    }
}

tasks.named("preBuild") {
    dependsOn(verifyWebAssets)
}


// 允许 `gradle :app:syncWeb :app:assembleRelease` 一行连跑：
// syncWeb 会写 assets 目录，必须排在 merge*Assets 之前，否则 Gradle 8.9 报隐式依赖冲突。
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach {
    mustRunAfter("syncWeb")
}
