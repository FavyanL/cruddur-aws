from flask import Flask, request
from flask_cors import CORS, cross_origin
import os
import logging 
import sys

from services.home_activities import *
from services.notifications_activities import *
from services.user_activities import *
from services.create_activity import *
from services.create_reply import *
from services.search_activities import *
from services.message_groups import *
from services.messages import *
from services.create_message import *
from services.show_activity import *
from services.show_me import *
from services.provision_user import *

from lib.cognito_jwt_token import CognitoJwtToken, extract_access_token, TokenVerifyError

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter  # Add this!
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import ALWAYS_ON 
from opentelemetry.instrumentation.flask import FlaskInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor

#X-Ray 
from aws_xray_sdk.core import xray_recorder
from aws_xray_sdk.ext.flask.middleware import XRayMiddleware
from aws_xray_sdk.core import patch_all

#Cloudwatch logs --
import watchtower, logging
from time import strftime

#Rollbar 
#import os
import rollbar
import rollbar.contrib.flask
from flask import got_request_exception

#configure logger to use CloudWatch (gracefully skip if no AWS credentials)
LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.DEBUG)
console_handler = logging.StreamHandler()
LOGGER.addHandler(console_handler)
try:
    cw_handler = watchtower.CloudWatchLogHandler(log_group='cruddur')
    LOGGER.addHandler(cw_handler)
    LOGGER.info("test log")
except Exception as e:
    LOGGER.warning(f"CloudWatch logging disabled (no AWS credentials): {e}")

# Initialize Flask app
app = Flask(__name__)

cognito_jwt_token = CognitoJwtToken(
    user_pool_id= os.getenv("AWS_COGNITO_USER_POOL_ID"), 
    user_pool_client_id= os.getenv("AWS_COGNITO_USER_POOL_CLIENT_ID"), 
    region= os.getenv("AWS_DEFAULT_REGION")
)

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

#Rollbar setup
rollbar_access_token = os.getenv('ROLLBAR_ACCESS_TOKEN')
@app.before_first_request
def init_rollbar():
    """init rollbar module"""
    rollbar.init(
        # access token
        rollbar_access_token,
        # environment name - any string, like 'production' or 'development'
        'production',
        # server root directory, makes tracebacks prettier
        root=os.path.dirname(os.path.realpath(__file__)),
        # flask already sets up logging
        allow_logging_basic_config=False)

    # send exceptions from `app` to rollbar, using flask's signal system.
    got_request_exception.connect(rollbar.contrib.flask.report_exception, app)

#Xray setup
xray_url = os.getenv("AWS_XRAY_URL")
xray_recorder.configure(
    service="backend-flask",
    daemon_address="localhost:2000",
    context_missing="LOG_ERROR",  # Prevent crashes if context is missing
)
patch_all()
XRayMiddleware(app, xray_recorder)
xray_recorder.begin_segment('FlaskAppInitialization')

# OpenTelemetry setup
# Load API key
honeycomb_api_key = os.getenv("HONEYCOMB_API_KEY")
if not honeycomb_api_key:
    logger.error("HONEYCOMB_API_KEY environment variable is not set!")
    raise ValueError("HONEYCOMB_API_KEY environment variable is missing!")

# Configure TracerProvider with AlwaysOnSampler
provider = TracerProvider(sampler=ALWAYS_ON)

# Set up OTLP exporter with Honeycomb
otlp_exporter = OTLPSpanExporter(
    endpoint="https://api.honeycomb.io:443/v1/traces",
    headers={"x-honeycomb-team": honeycomb_api_key}
)
provider.add_span_processor(BatchSpanProcessor(otlp_exporter))

# Optional: Add ConsoleSpanExporter for debugging
console_processor = ConsoleSpanExporter()
provider.add_span_processor(BatchSpanProcessor(console_processor))

trace.set_tracer_provider(provider)
tracer = trace.get_tracer(__name__)

# Instrument Flask and requests
FlaskInstrumentor().instrument_app(app)
RequestsInstrumentor().instrument()

# Enable CORS
frontend = os.getenv('FRONTEND_URL')
backend = os.getenv('BACKEND_URL')
origins = [frontend, backend]
cors = CORS(
    app, 
    resources={r"/api/*": {"origins": origins}},
    supports_credentials=True,  # Allow credentials like Authorization tokens
    allow_headers=[
        "Content-Type",
        "Authorization",  # ✅ Explicitly allow Authorization header
        "If-Modified-Since"
    ],
    expose_headers=[
        "Authorization",
        "Location",
        "Link"
    ],
    methods="OPTIONS,GET,HEAD,POST"
)

# Returns the Cognito user id ('sub' claim) from a verified JWT,
# or None if the request has no token / an invalid or expired token.
def get_cognito_user_id():
    access_token = extract_access_token(request.headers)
    try:
        claims = cognito_jwt_token.verify(access_token)
        return claims['sub']
    except TokenVerifyError:
        return None

# Returns ALL claims from a verified JWT, or None.
#
# Cognito issues two different tokens and they carry different things:
#   - the ACCESS token proves "this request is authenticated" and carries 'sub'
#   - the ID token describes "who this person is" and carries 'sub' PLUS the user
#     attributes: email, name, preferred_username
#
# Everywhere else in this app we send the access token, because all we need is 'sub'.
# Provisioning is the one place we need the attributes, so it sends the ID token.
#
# expected_token_use pins down which one we'll accept. Without this check the two are
# interchangeable to our verifier (it validates the signature but never looks at what
# KIND of token it is), and a route could silently accept the wrong one. Being explicit
# is the safer habit — this is the same discipline as scoping an IAM policy to exactly
# the actions it needs.
def get_cognito_claims(expected_token_use):
    token = extract_access_token(request.headers)
    try:
        claims = cognito_jwt_token.verify(token)
        if claims.get('token_use') != expected_token_use:
            return None
        return claims
    except TokenVerifyError:
        return None

@app.after_request
def after_request(response):
    timestamp =strftime('[%Y-%b-%d %H:%M]')
    LOGGER.error('%s %s %s %s %s %s', timestamp, request.remote_addr, request.method, request.scheme, request.full_path, response.status )
    return response

@app.route('/rollbar/test')
def rollbar_test():
    rollbar.report_message('Hello world!', 'warning')
    return "Hello World!"

@app.route("/")
def home():
    with tracer.start_as_current_span("home-handler"):
        return {"message": "Hello, Honeycomb!"}, 200

@app.route("/api/users/me", methods=['GET'])
def data_me():
    cognito_user_id = get_cognito_user_id()
    if cognito_user_id is None:
        return {'errors': ['unauthenticated']}, 401
    data = ShowMe.run(cognito_user_id=cognito_user_id)
    if data is None:
        # Valid Cognito account, but no matching row in our users table.
        # The frontend answers this by calling /api/users/provision below.
        return {'errors': ['user_not_found']}, 404
    return data, 200

@app.route("/api/users/provision", methods=['POST'])
def data_provision_user():
    # Expects the ID token (not the access token) — that's the only one carrying the
    # email / name / preferred_username attributes we need to build the profile row.
    claims = get_cognito_claims(expected_token_use='id')
    if claims is None:
        return {'errors': ['unauthenticated']}, 401

    # Where does the handle live? Two possibilities, depending on how the pool is set up:
    #
    #   preferred_username  - an optional Cognito attribute. Nicer, because it lets the
    #                         handle differ from the login username. Only present if the
    #                         app client allows writing it.
    #   cognito:username    - ALWAYS present on an ID token. In this pool the username IS
    #                         the handle (email is only an alias), so this is our handle.
    #
    # Prefer the explicit attribute, fall back to the username. Reading both means this
    # keeps working if you later enable preferred_username, without another code change.
    handle = claims.get('preferred_username') or claims.get('cognito:username')
    if not handle:
        # Cognito knows this account but we can't determine a handle for it — nothing we
        # invent would be right, so refuse rather than write a junk row.
        return {'errors': ['missing_handle']}, 422

    data = ProvisionUser.run(
        cognito_user_id = claims['sub'],
        email           = claims.get('email'),
        handle          = handle,
        display_name    = claims.get('name') or handle
    )
    if data is None:
        return {'errors': ['provision_failed']}, 500
    return data, 200

@app.route("/api/message_groups", methods=['GET'])
def data_message_groups():
    cognito_user_id = get_cognito_user_id()
    if cognito_user_id is None:
        return {'errors': ['unauthenticated']}, 401
    model = MessageGroups.run(cognito_user_id=cognito_user_id)
    if model['errors']:
        return model['errors'], 422
    return model['data'], 200

@app.route("/api/messages/@<string:handle>", methods=['GET'])
def data_messages(handle):
    cognito_user_id = get_cognito_user_id()
    if cognito_user_id is None:
        return {'errors': ['unauthenticated']}, 401
    user_receiver_handle = handle
    model = Messages.run(cognito_user_id=cognito_user_id, user_receiver_handle=user_receiver_handle)
    if model['errors']:
        return model['errors'], 422
    return model['data'], 200

@app.route("/api/messages", methods=['POST', 'OPTIONS'])
@cross_origin()
def data_create_message():
    cognito_user_id = get_cognito_user_id()
    if cognito_user_id is None:
        return {'errors': ['unauthenticated']}, 401
    user_receiver_handle = request.json['user_receiver_handle']
    message = request.json['message']
    model = CreateMessage.run(
        message=message,
        cognito_user_id=cognito_user_id,
        user_receiver_handle=user_receiver_handle
    )
    if model['errors']:
        return model['errors'], 422
    return model['data'], 200

@app.route("/api/activities/home", methods=['GET'])
def data_home():
    print(f"🔍 Request Headers: {request.headers}")  # Debugging
    access_token = extract_access_token(request.headers)
    print(f"🔑 Extracted Token: {access_token}")  # Log the extracted token 
    access_token = extract_access_token(request.headers)
    try:
        claims = cognito_jwt_token.verify(access_token)
        app.logger.debug('authenticated')
        app.logger.debug(claims)
    except TokenVerifyError as e:
        app.logger.debug("unathenticated")

    data = HomeActivities.run(Logger=LOGGER)
    
    return data, 200

@app.route("/api/activities/notifications", methods=['GET'])
def data_notifications():
    data = NotificationsActivities.run()
    return data, 200

@app.route("/api/health-check", methods=['GET'])
def health_check():
    return {'success':True}, 200

@app.route("/api/activities/@<string:handle>", methods=['GET'])
def data_handle(handle):
    model = UserActivities.run(handle)
    if model['errors']:
        return model['errors'], 422
    return model['data'], 200

@app.route("/api/activities/search", methods=['GET'])
def data_search():
    term = request.args.get('term')
    model = SearchActivities.run(term)
    if model['errors']:
        return model['errors'], 422
    return model['data'], 200

@app.route("/api/activities", methods=['POST', 'OPTIONS'])
@cross_origin()
def data_activities():
    cognito_user_id = get_cognito_user_id()
    if cognito_user_id is None:
        return {'errors': ['unauthenticated']}, 401
    message = request.json['message']
    ttl = request.json['ttl']
    model = CreateActivity.run(message, cognito_user_id, ttl)
    if model['errors']:
        return model['errors'], 422
    return model['data'], 200

@app.route("/api/activities/<string:activity_uuid>", methods=['GET'])
def data_show_activity(activity_uuid):
    data = ShowActivity.run(activity_uuid=activity_uuid)
    return data, 200

@app.route("/api/activities/<string:activity_uuid>/reply", methods=['POST', 'OPTIONS'])
@cross_origin()
def data_activities_reply(activity_uuid):
    cognito_user_id = get_cognito_user_id()
    if cognito_user_id is None:
        return {'errors': ['unauthenticated']}, 401
    message = request.json['message']
    model = CreateReply.run(message, cognito_user_id, activity_uuid)
    if model['errors']:
        return model['errors'], 422
    return model['data'], 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=4567, debug=True)

@app.route("/test-xray")
def test_xray():
    try:
        print("🔍 Checking AWS X-Ray Recorder State...")

        # Force-start a new segment if missing
        if xray_recorder.current_segment() is None:
            print("⚠️ No active segment found, creating a new one.")
            xray_recorder.begin_segment("TestSegment")

        # Start a subsegment (required for HTTP metadata)
        with xray_recorder.in_segment("TestSegment") as segment:
            with xray_recorder.in_subsegment("TestSubsegment") as subsegment:
                subsegment.put_annotation("test", "flask-xray")
                subsegment.put_metadata("debug_info", {"env": os.environ.get("AWS_REGION")})

        return {"message": "X-Ray Trace Successful"}, 200
    except Exception as e:
        print(f"❌ Error in X-Ray Test: {e}")
        return {"error": str(e)}, 500

@app.route("/debug-xray")
def debug_xray():
    try:
        segment = xray_recorder.begin_segment("DebugXRaySegment")
        subsegment = xray_recorder.begin_subsegment("DebugXRaySubsegment")

        # Add debugging data
        subsegment.put_annotation("test", "debugging-xray")
        subsegment.put_metadata("env", os.environ.get("AWS_REGION"), "debug-metadata")

        xray_recorder.end_subsegment()
        xray_recorder.end_segment()

        return {"message": "Debug X-Ray segment sent!"}, 200
    except Exception as e:
        return {"error": str(e)}, 500

