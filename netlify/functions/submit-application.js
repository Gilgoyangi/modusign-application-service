// 파일명: netlify/functions/submit-application.js

// 필요한 전문 도구들(라이브러리)을 불러옵니다.
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const busboy = require('busboy');

// 이 함수는 파일과 텍스트 데이터를 함께 처리하기 위해 특별한 방식으로 작성되었습니다.
exports.handler = async (event, context) => {

    // Netlify에 안전하게 저장될 비밀 정보들을 가져옵니다.
    const {
        MODUSIGN_API_KEY,
        GOOGLE_SERVICE_ACCOUNT_EMAIL,
        GOOGLE_PRIVATE_KEY,
        TEMPLATE_ID 
    } = process.env;

    // Google Drive API와 통신하기 위한 인증 준비
    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Netlify 환경 변수 형식에 맞게 줄바꿈 문자를 복원
        },
        scopes: ['https://www.googleapis.com/auth/drive'],
    });
    const drive = google.drive({ version: 'v3', auth });

    // Busboy를 사용해 폼 데이터를 파싱하는 Promise 생성
    const parseMultipartForm = () => new Promise((resolve, reject) => {
        const bb = busboy({ headers: event.headers });
        const fields = {};
        const files = [];

        bb.on('file', (name, file, info) => {
            const { filename, encoding, mimeType } = info;
            const chunks = [];
            file.on('data', (chunk) => chunks.push(chunk));
            file.on('end', () => {
                files.push({
                    fieldName: name,
                    content: Buffer.concat(chunks),
                    filename,
                    encoding,
                    mimeType,
                });
            });
        });

        bb.on('field', (name, val) => {
            fields[name] = val;
        });

        bb.on('close', () => resolve({ fields, files }));
        bb.on('error', err => reject(err));
        bb.end(Buffer.from(event.body, 'base64'));
    });

    try {
        // 1. [데이터 수신] index.html에서 보낸 지원서 정보(텍스트, 파일)를 받습니다.
        const { fields, files } = await parseMultipartForm();
        const uniqueIdentifierValue = fields.uniqueIdentifier; // 관리자가 설정한 고유값
        const FOLDER_NAME = `[지원서] ${uniqueIdentifierValue}`;

        // 2. [Google Drive] 지원자 이름으로 폴더를 생성합니다.
        const folderResponse = await drive.files.create({
            resource: {
                name: FOLDER_NAME,
                mimeType: 'application/vnd.google-apps.folder',
                parents: ['YOUR_GOOGLE_DRIVE_FOLDER_ID'] // TODO: 실제 부모 폴더 ID로 교체 필요
            },
            fields: 'id',
        });
        const folderId = folderResponse.data.id;

        // 3. [Google Drive] 생성된 폴더에 첨부파일들을 업로드합니다.
        for (const file of files) {
            await drive.files.create({
                resource: {
                    name: file.filename,
                    parents: [folderId],
                },
                media: {
                    mimeType: file.mimeType,
                    body: Buffer.from(file.content).toString('binary'),
                },
            });
        }

        // 4. [모두싸인] 서명 요청을 위한 데이터를 준비합니다.
        //    - participantMappings: 서명 참여자(지원자) 정보
        //    - requesterInputMappings: 관리자가 설정한 텍스트 필드 값
        const participantMappings = [{
            role: '지원자', // 템플릿에 설정된 역할명과 일치해야 함
            name: fields['지원자명'] || '', // '지원자명'은 데이터 라벨
            signingMethod: {
                type: 'EMAIL',
                value: fields['이메일'] || '' // '이메일'은 데이터 라벨
            }
        }];

        const requesterInputMappings = Object.entries(fields)
            .filter(([key]) => key !== 'password' && key !== 'uniqueIdentifier') // 비밀번호와 고유값은 제외
            .map(([key, value]) => ({ dataLabel: key, value: value }));

        // 5. [모두싸인] '템플릿으로 서명 요청' API를 호출합니다.
        const modusignResponse = await fetch(`https://api.modusign.co.kr/templates/${TEMPLATE_ID}/requests`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${Buffer.from(MODUSIGN_API_KEY + ':').toString('base64')}`
            },
            body: JSON.stringify({
                document: {
                    title: FOLDER_NAME,
                    participantMappings: participantMappings,
                    requesterInputMappings: requesterInputMappings
                }
            })
        });

        if (!modusignResponse.ok) {
            const errorBody = await modusignResponse.text();
            throw new Error(`모두싸인 API 오류: ${errorBody}`);
        }

        // 6. [최종 성공] 모든 과정이 성공했음을 index.html에 알립니다.
        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: '지원서가 성공적으로 제출되었습니다.' })
        };

    } catch (error) {
        // 7. [최종 실패] 과정 중 하나라도 실패하면 에러를 기록하고 실패를 알립니다.
        console.error('Submission failed:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, message: error.message })
        };
    }
};
