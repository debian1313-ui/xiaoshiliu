/**
 * 极验验证码 (GeetestV4) composable
 * 用于在Vue组件中方便地集成极验验证码
 */
import { ref, onMounted, onUnmounted } from 'vue'

// 从环境变量获取前端配置（用于本地化判断，避免闪烁）
const GEETEST_ENABLED_LOCAL = import.meta.env.VITE_GEETEST_ENABLED === 'true'

/**
 * 动态加载极验SDK脚本
 * @returns {Promise<void>}
 */
const loadGeetestScript = () => {
  return new Promise((resolve, reject) => {
    // 如果已经加载过，直接返回
    if (window.initGeetest4) {
      resolve()
      return
    }

    const script = document.createElement('script')
    script.src = 'https://static.geetest.com/v4/gt4.js'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('极验SDK加载失败'))
    document.head.appendChild(script)
  })
}

/**
 * 极验验证码 composable
 * @param {Object} options - 配置选项
 * @param {string} options.captchaId - 验证码ID（从后端获取或环境变量）
 * @param {string} options.product - 验证码展现形式 ('popup' | 'float' | 'bind')
 * @returns {Object} - 返回验证码相关状态和方法
 */
export function useGeetest(options = {}) {
  const { 
    captchaId = '',
    product = 'bind' // 默认使用bind模式，适合表单验证场景
  } = options

  // 状态
  const isReady = ref(false)
  const isLoading = ref(false)
  const error = ref(null)
  const captchaResult = ref(null)
  
  // 验证码实例
  let captchaObj = null

  /**
   * 初始化极验验证码
   * @param {string} id - 验证码ID
   * @returns {Promise<void>}
   */
  const initCaptcha = async (id) => {
    if (!id) {
      error.value = '验证码ID不能为空'
      return
    }

    isLoading.value = true
    error.value = null

    try {
      // 加载SDK
      await loadGeetestScript()

      // 初始化验证码
      return new Promise((resolve, reject) => {
        window.initGeetest4({
          captchaId: id,
          product: product,
          language: 'zho', // 简体中文
          protocol: 'https://' // 强制使用https协议，避免相对路径问题
        }, (obj) => {
          captchaObj = obj

          // 监听验证码准备就绪
          captchaObj.onReady(() => {
            isReady.value = true
            isLoading.value = false
            resolve()
          })

          // 监听验证成功
          captchaObj.onSuccess(() => {
            const result = captchaObj.getValidate()
            if (result) {
              captchaResult.value = {
                lot_number: result.lot_number,
                captcha_output: result.captcha_output,
                pass_token: result.pass_token,
                gen_time: result.gen_time
              }
            }
          })

          // 监听验证失败
          captchaObj.onFail(() => {
            captchaResult.value = null
          })

          // 监听错误
          captchaObj.onError((err) => {
            console.error('极验验证码错误:', err)
            error.value = err.msg || '验证码加载失败'
            isLoading.value = false
            reject(err)
          })
        })
      })
    } catch (err) {
      console.error('初始化极验验证码失败:', err)
      error.value = err.message || '验证码初始化失败'
      isLoading.value = false
      throw err
    }
  }

  /**
   * 显示验证码（用于bind模式）
   * @returns {Promise<Object>} - 返回验证结果
   */
  const showCaptcha = () => {
    return new Promise((resolve, reject) => {
      if (!captchaObj) {
        reject(new Error('验证码未初始化'))
        return
      }

      if (!isReady.value) {
        reject(new Error('验证码未就绪'))
        return
      }

      // 重置之前的结果
      captchaResult.value = null
      
      // 使用标志位来确保回调只处理一次
      let handled = false

      // 设置一次性成功回调
      const successHandler = () => {
        if (handled) return
        handled = true
        
        const result = captchaObj.getValidate()
        if (result) {
          captchaResult.value = {
            lot_number: result.lot_number,
            captcha_output: result.captcha_output,
            pass_token: result.pass_token,
            gen_time: result.gen_time
          }
          resolve(captchaResult.value)
        } else {
          reject(new Error('获取验证结果失败'))
        }
      }

      // 设置关闭回调
      const closeHandler = () => {
        if (handled) return
        handled = true
        
        if (!captchaResult.value) {
          reject(new Error('用户取消验证'))
        }
      }

      // 绑定回调（Geetest SDK不支持移除回调，使用handled标志位确保只处理一次）
      captchaObj.onSuccess(successHandler)
      captchaObj.onClose(closeHandler)

      // 显示验证码
      captchaObj.showCaptcha()
    })
  }

  /**
   * 重置验证码
   */
  const reset = () => {
    captchaResult.value = null
    if (captchaObj) {
      captchaObj.reset()
    }
  }

  /**
   * 销毁验证码实例
   */
  const destroy = () => {
    if (captchaObj) {
      captchaObj.destroy()
      captchaObj = null
    }
    isReady.value = false
    captchaResult.value = null
    error.value = null
  }

  /**
   * 获取验证结果
   * @returns {Object|null}
   */
  const getResult = () => {
    return captchaResult.value
  }

  // 组件卸载时销毁
  onUnmounted(() => {
    destroy()
  })

  return {
    // 状态
    isReady,
    isLoading,
    error,
    captchaResult,
    
    // 方法
    initCaptcha,
    showCaptcha,
    reset,
    destroy,
    getResult,
    
    // 本地配置（用于避免闪烁）
    isGeetestEnabledLocal: GEETEST_ENABLED_LOCAL
  }
}

export default useGeetest
