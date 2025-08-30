// 파일명: netlify/functions/get-template-details.js

exports.handler = async (event, context) => {
  // 1. admin.html에서 보낸 요청에서 API Key와 Template ID를 꺼냅니다.
  const { apiKey, templateId } = JSON.parse(event.body);

  // 2. 모두싸인 API에 접속하기 위한 주소를 준비합니다.
  const url = `https://api.modusign.co.kr/templates/${templateId}`;

  try {
    // 3. fetch를 사용해 모두싸인 서버에 실제 GET 요청을 보냅니다.
    //    이때, HTTP 헤더에 API Key를 포함시켜 우리가 누구인지 인증합니다.
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`
      }
    });

    // 4. 응답이 성공적이지 않으면 에러를 발생시킵니다.
    if (!response.ok) {
      throw new Error(`API 요청 실패: ${response.status} ${response.statusText}`);
    }

    // 5. 성공했다면, 응답 데이터를 JSON 형태로 변환합니다.
    const data = await response.json();

    // 6. 성공 결과와 함께 필요한 데이터(데이터 라벨)를 admin.html 페이지로 돌려줍니다.
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        data: data 
      })
    };
  } catch (error) {
    // 7. 과정 중에 에러가 발생하면, 실패 결과와 에러 메시지를 돌려줍니다.
    console.error('Error fetching template details:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: error.message })
    };
  }
};
