// 仓库源：google() 提供 AGP / androidx；阿里云 public 作为兜底。
// 刻意不写 gradlePluginPortal：AGP 不在那里，写上只会让解析多绕一圈。
pluginManagement {
    repositories {
        google()
        maven("https://maven.aliyun.com/repository/public")
        mavenCentral()
    }
}

dependencyResolutionManagement {
    // 设计 §7 原本要 FAIL_ON_PROJECT_REPOS。本机环境里有一个全局
    // ~/.gradle/init.gradle 会给所有工程追加 project 仓库，FAIL_ON_PROJECT_REPOS 会在
    // 配置阶段直接抛错（"repository 'maven' was added by initialization script"）。
    // 用 PREFER_SETTINGS 达到同样的目的：settings 里声明的仓库优先，init 脚本追加的
    // project 仓库被忽略，最终依赖来源仍然只有下面这几行。
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        maven("https://maven.aliyun.com/repository/public")
        mavenCentral()
    }
}

rootProject.name = "bottle-focus"
include(":app")
