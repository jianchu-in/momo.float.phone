exports.handler = async (event, context) => {
  const apiKey = process.env.ZHIPU_API_KEY
  
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }
  
  try {
    const body = JSON.parse(event.body)
    const path = body._path || '/chat/completions'
    
    // 移除 Float 内部标记字段
    delete body._path
    
    // 根据路径选择不同接口
    const url = path.includes('/images/generations')
      ? 'https://api.siliconflow.cn/v1/images/generations'
      : 'https://api.siliconflow.cn/v1/chat/completions'
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    
    const data = await response.json()
    return {
      statusCode: response.status,
      body: JSON.stringify(data)
    }
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    }
  }
}
