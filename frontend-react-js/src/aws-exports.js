const awsExports = {
  Auth: {
      Cognito: {
          region: process.env.REACT_APP_AWS_COGNITO_REGION,
          userPoolId: process.env.REACT_APP_AWS_COGNITO_USER_POOLS_ID,
          userPoolClientId: process.env.REACT_APP_CLIENT_ID,
      },
      oauth: {
          //domain: process.env.REACT_APP_OAUTH_DOMAIN,
          //scope: ['email', 'openid', 'profile'],
          //redirectSignIn: process.env.REACT_APP_REDIRECT_SIGN_IN,
          //redirectSignOut: process.env.REACT_APP_REDIRECT_SIGN_OUT,
          //responseType: 'code',
      }
  }
};
export default awsExports;








